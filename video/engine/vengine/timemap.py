"""Time map: source time <-> output time.

The edit is a list of pieces laid out on the output timeline:
  * clip   — plays source [src_start, src_end) at a given speed
  * freeze — holds one source frame for `dur` seconds

Consecutive pieces overlap by `xfade` seconds and are cross-faded (video: linear blend,
audio: equal-power), so cuts are soft. The same map drives video, audio and every effect,
which is what keeps everything in sync.
"""
from dataclasses import dataclass
import numpy as np

from .media import AUDIO_SR


@dataclass
class Piece:
    kind: str            # "clip" | "freeze"
    src_start: float
    src_end: float       # == src_start for a freeze
    speed: float = 1.0
    dur: float = 0.0     # output duration (freeze), computed for clips
    out_start: float = 0.0
    fade_in: float = 0.0
    fade_out: float = 0.0

    @property
    def out_end(self):
        return self.out_start + self.dur

    def src_at(self, t_out):
        if self.kind == "freeze":
            return self.src_start
        return self.src_start + (t_out - self.out_start) * self.speed

    def weight(self, t_out):
        w = 1.0
        if self.fade_in > 0:
            w = min(w, (t_out - self.out_start) / self.fade_in)
        if self.fade_out > 0:
            w = min(w, (self.out_end - t_out) / self.fade_out)
        return float(np.clip(w, 0.0, 1.0))


class TimeMap:
    def __init__(self, xfade=0.08):
        self.xfade = xfade
        self.pieces: list[Piece] = []

    # ---- building ----------------------------------------------------------
    def clip(self, a, b, speed=1.0):
        self.pieces.append(Piece("clip", a, b, speed))
        return self

    def freeze(self, t, dur, xfade=True):
        """Insert a frozen frame of source time t, lasting dur seconds (output)."""
        self.pieces.append(Piece("freeze", t, t, dur=dur))
        return self

    @classmethod
    def keep(cls, segments, xfade=0.08):
        tm = cls(xfade)
        for a, b in segments:
            tm.clip(a, b)
        return tm.layout()

    def layout(self):
        """Place pieces on the output timeline, overlapping neighbours by xfade."""
        t = 0.0
        for i, p in enumerate(self.pieces):
            if p.kind == "clip":
                p.dur = (p.src_end - p.src_start) / p.speed
            # a cut between two contiguous clips (no gap in source) needs no fade
            joined_prev = i > 0 and self._contiguous(self.pieces[i - 1], p)
            p.fade_in = 0.0 if (i == 0 or joined_prev) else self.xfade
            p.fade_out = 0.0
            if i > 0 and not joined_prev:
                self.pieces[i - 1].fade_out = self.xfade
                t -= self.xfade
            p.out_start = t
            t = p.out_end
        self.duration = t
        return self

    @staticmethod
    def _contiguous(a, b):
        return a.kind == b.kind == "clip" and abs(a.src_end - b.src_start) < 1e-6 and a.speed == b.speed

    # ---- queries ---------------------------------------------------------
    def sources_at(self, t_out):
        """[(src_time, weight), ...] contributing to output time t_out (weights sum to 1)."""
        hits = [(p.src_at(t_out), p.weight(t_out)) for p in self.pieces if p.out_start <= t_out < p.out_end]
        if not hits:
            p = self.pieces[-1] if t_out >= self.pieces[-1].out_start else self.pieces[0]
            return [(p.src_at(min(max(t_out, p.out_start), p.out_end - 1e-6)), 1.0)]
        s = sum(w for _, w in hits) or 1.0
        return [(t, w / s) for t, w in hits]

    def to_out(self, t_src):
        """Where source time t_src lands in the output. A time inside a removed gap snaps to the
        start of the next kept piece (so an effect on a cut word still appears at the cut)."""
        best = None
        for p in self.pieces:
            if p.kind != "clip":
                continue
            if p.src_start <= t_src <= p.src_end:
                return p.out_start + (t_src - p.src_start) / p.speed
            if p.src_start > t_src and (best is None or p.src_start < best.src_start):
                best = p
        return best.out_start if best else self.duration

    def is_kept(self, t_src):
        return any(p.kind == "clip" and p.src_start <= t_src < p.src_end for p in self.pieces)

    # ---- audio -----------------------------------------------------------
    def render_audio(self, audio, sr=AUDIO_SR):
        """Cut the source audio with exactly the same map (equal-power crossfades, silence on freezes)."""
        n = int(round(self.duration * sr))
        out = np.zeros((n, audio.shape[1]), np.float32)
        for p in self.pieces:
            o0 = int(round(p.out_start * sr))
            m = int(round(p.dur * sr))
            if p.kind == "freeze" or m <= 0:
                continue
            src_idx = p.src_start * sr + np.arange(m) * p.speed
            if p.speed == 1.0:
                s0 = int(round(p.src_start * sr))
                seg = np.asarray(audio[s0:s0 + m], np.float32)
            else:  # simple resample for speed ramps
                idx = np.clip(src_idx.astype(np.int64), 0, len(audio) - 1)
                seg = np.asarray(audio[idx], np.float32)
            env = np.ones(len(seg), np.float32)
            t = np.arange(len(seg)) / sr
            if p.fade_in > 0:
                env *= np.sin(0.5 * np.pi * np.clip(t / p.fade_in, 0, 1))
            if p.fade_out > 0:
                env *= np.sin(0.5 * np.pi * np.clip((p.dur - t) / p.fade_out, 0, 1))
            end = min(o0 + len(seg), n)
            out[o0:end] += seg[: end - o0] * env[: end - o0, None]
        return out

    def describe(self):
        rows = []
        for p in self.pieces:
            if p.kind == "clip":
                rows.append(f"clip   src {p.src_start:6.2f}-{p.src_end:6.2f}  ->  out {p.out_start:6.2f}-{p.out_end:6.2f}")
            else:
                rows.append(f"freeze src {p.src_start:6.2f} for {p.dur:.2f}s  ->  out {p.out_start:6.2f}-{p.out_end:6.2f}")
        rows.append(f"total {self.duration:.2f}s")
        return "\n".join(rows)


def cut_silences(words, src_duration, max_gap=0.35, pad_before=0.08, pad_after=0.12, min_keep=0.0,
                 head=0.15, tail=0.3):
    """Keep segments built from word timings: any pause between words longer than max_gap is cut,
    leaving a small breathing pad on each side. Returns [(start, end), ...] in source time."""
    if not words:
        return [(0.0, src_duration)]
    segs = []
    a = max(0.0, words[0]["start"] - head)
    b = words[0]["end"]
    for w in words[1:]:
        if w["start"] - b > max_gap:
            segs.append((a, min(b + pad_after, src_duration)))
            a = max(w["start"] - pad_before, segs[-1][1])
        b = max(b, w["end"])
    segs.append((a, min(b + tail, src_duration)))
    return [(x, y) for x, y in segs if y - x > min_keep]
