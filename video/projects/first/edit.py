"""ערב מסכות — the edit. Everything sits on a 124 BPM beat grid: cuts, title pops, hits and music.

Structure (beats):
   0-4   HOOK      flash-forward to the funniest moment + title "ערב מסכות עם הבנות" behind the people
   4-5   REWIND    VHS rewind back to the start ("רגע לפני...")
   5-11  mask on   (sped up, punch-in cuts)
  11-14  the mask packet with the friend
  14-18  talking   (real time, music ducks under the voice)
  18-21  leaning in to camera
  21-22  WHIP      the camera swing becomes the transition (whoosh + flash)
  22-25  the friends (riser builds)
  25-31  DROP      finale: laughs + the nose — impact, shake, beat-pulse zooms
  31-35  FREEZE    jump back to the biggest laugh, frozen + call to action

    python3 edit.py                 # full render + contact sheets
    python3 edit.py --preview 4 8   # quick render of output seconds 4..8
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "engine"))

import cv2
import numpy as np
from vengine import Source, TimeMap, render, contact_sheet
from vengine.comp import cover, cover_matrix, ease_out_cubic, clamp01
from vengine.captions import Captions, LOOKS
from vengine.titles import Title
from vengine.transcribe import word_table
from vengine import fx, music as M
from vengine.media import AUDIO_SR as SR

W, H, FPS = 1080, 1920, 30
BPM = 124
BEAT = 60 / BPM


def B(n):
    return n * BEAT


src = Source(os.path.join(HERE, "..", "..", "source.mov"), os.path.join(HERE, "cache"))

# ---- 1. cuts on the beat grid --------------------------------------------------------------
tm = TimeMap(xfade=0.0)                         # hard cuts — they land on beats
tm.clip(18.0, 18.0 + B(4), gain=0.9)            # 0-4   hook: the nose moment (real time)
tm.clip(18.0 + B(4), 0.6, dur=B(1), gain=0)     # 4-5   rewind
tm.clip(0.6, 4.4, dur=B(6), gain=0.3)           # 5-11  putting the mask on
tm.clip(4.6, 6.6, dur=B(3), gain=0.3)           # 11-14 the packet
tm.clip(7.75, 7.75 + B(4), gain=1.0)            # 14-18 talking (real time)
tm.clip(10.6, 12.55, dur=B(3), gain=0.3)        # 18-21 leaning in
tm.clip(12.6, 14.1, dur=B(1), gain=0)           # 21-22 whip transition
tm.clip(14.3, 16.0, dur=B(3), gain=0.5)         # 22-25 the friends
tm.clip(16.0, 16.0 + B(6), gain=1.0)            # 25-31 finale (real time)
tm.freeze(17.3, B(4))                           # 31-35 freeze on the biggest laugh + CTA
tm.layout()

PIECE_ZOOM = [1.06, 1.0, 1.0, 1.1, 1.0, 1.12, 1.0, 1.05, 1.0, 1.04]   # alternating framing = "multi-cam" feel
REWIND, WHIP, FINALE, FREEZE = 1, 6, 8, 9
DROP = B(25)

# ---- 2. text --------------------------------------------------------------------------------
P = LOOKS["poster"].base
P = P.replace(shadow=14, shadow_alpha=210, hard_shadow=(0, 11, P.hard_shadow[2]))
title = Title(["ערב מסכות", "עם הבנות"], [B(0), B(0.5), B(1.5), B(2)], P.replace(size=150), y=0.16,
              end=B(4), tilt=6)
before = Title(["רגע לפני..."], [B(4), B(4.25)], P.replace(size=110), y=0.17, end=B(6.5), tilt=4)
cta = Title(["תייגו חברה", "שחייבת", "ערב כזה"], [B(31.5), B(32), B(32.5), B(33), B(33.5)],
            P.replace(size=140), y=0.19, end=None, tilt=5)
TITLES = [title, before, cta]

words_path = os.path.join(HERE, "words.json")
words = json.load(open(words_path, encoding="utf-8")) if os.path.exists(words_path) else []
caps = Captions(words, tm, look="poster", W=W, H=H) if words else None

GRADE = fx.make_grade()


# ---- 3. picture -----------------------------------------------------------------------------
def camera(t, i, p):
    """zoom, rotation and offset of the virtual camera at output time t."""
    z = PIECE_ZOOM[i]
    if i > 0 and i not in (REWIND,):
        z += fx.punch(t, p.out_start, 0.07, 0.25)            # every cut lands with a small punch-in
    if i == FINALE:                                          # drop: pulse on every beat
        k = int((t - DROP) / BEAT)
        z += fx.punch(t, DROP + k * BEAT, 0.035, 0.22)
    if i == FREEZE:                                          # slow push-in on the freeze frame
        z += 0.1 * ease_out_cubic((t - p.out_start) / p.dur)
    dx, dy, rot = fx.shake(t, DROP, 0.45, 26)
    dx2, dy2, rot2 = fx.shake(t, B(22), 0.3, 18)
    return z, dx + dx2, dy + dy2, rot + rot2


def source_image(ts, i, p, t):
    """Graded source frame; fast pieces get motion blur from several sub-frames."""
    if abs(p.speed) > 2.5:
        n = 4
        subs = [p.src_at(t + k / (FPS * n)) for k in range(n)]
        acc = sum(src.frame_at(s).astype(np.float32) for s in subs) / n
        return fx.grade(acc.astype(np.uint8), GRADE)
    return fx.grade(src.frame_at(ts), GRADE)


def frame(t):
    i, p = tm.piece_at(t)
    ts = p.src_at(t)
    z, dx, dy, rot = camera(t, i, p)
    img = source_image(ts, i, p, t)
    f = cover(img, W, H, zoom=z, cy=0.48, rot=rot, dx=dx, dy=dy).astype(np.float32)

    if i == REWIND:                                          # VHS rewind
        k = (t - p.out_start) / p.dur
        g = f.mean(2, keepdims=True)
        f = f * 0.55 + g * 0.45
        f = fx.rgb_split(f, 10 + 14 * np.sin(np.pi * k))
        fx.scanlines(f, 0.22, t)
        fx.tracking_noise(f, t)

    fx.vignette(f, 0.25)

    matte = None
    if title.active(t):                                      # title sits behind the people
        m = src.mask_at(ts)
        if m is not None:
            Mx = cover_matrix(src.w, src.h, W, H, z, 0.5, 0.48, rot, dx, dy)
            matte = 1 - cv2.warpAffine(m, Mx, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    for T in TITLES:
        T.draw(f, t, matte)
    if caps:
        caps.draw(f, t)

    # flashes on the big moments
    fl = max(0.85 * (1 - clamp01((t - B(5)) / 0.18)) if t >= B(5) else 0,
             0.7 * (1 - clamp01((t - B(22)) / 0.16)) if t >= B(22) else 0,
             1.0 * (1 - clamp01((t - DROP) / 0.25)) if t >= DROP else 0,
             0.9 * (1 - clamp01((t - B(31)) / 0.2)) if t >= B(31) else 0)
    fx.flash(f, fl)
    return f


# ---- 4. sound -------------------------------------------------------------------------------
def build_music():
    T = M.Track(tm.duration + 2)
    # hook: full chorus groove straight away + a hit on frame one
    hook = M.bar_music(BPM, 0, {"kick", "clap", "hats", "bass", "chords", "lead"}, cutoff=3200)
    T.add(0, hook, 0.9)
    T.add(0, M.impact(), 0.7)
    for w in title.words:
        T.add(w["t"], M.pop(86 + 3 * w["i"]), 0.6)
    # rewind: the music tape-stops, rewind chatter
    nxt = M.bar_music(BPM, 1, {"kick", "hats", "bass", "chords", "lead"}, cutoff=3200)[: int(B(1) * SR)]
    T.add(B(4), M.tape_stop(nxt, B(1)), 0.8)
    T.add(B(4), M.rewind(B(1)), 0.9)
    for w in before.words:
        T.add(w["t"], M.pop(79), 0.4)
    # main song from beat 5, bar by bar
    plan = [
        (5, {"kick", "hats", "bass", "chords"}, 900),
        (9, {"kick", "clap", "hats", "bass", "chords"}, 1400),
        (13, {"kick", "hats", "bass", "chords"}, 1400),
        (17, {"kick", "clap", "hats", "bass", "chords"}, 2000),
        (21, {"hats", "bass", "chords"}, 2400),                       # build
        (25, {"kick", "clap", "hats", "bass", "chords", "lead"}, 3400),  # drop
    ]
    for n, (beat, parts, cut) in enumerate(plan):
        T.add(B(beat), M.bar_music(BPM, n, parts, cutoff=cut), 0.9)
    T.add(B(29), M.bar_music(BPM, 1, {"kick", "clap", "hats", "bass", "chords", "lead"}, 3400)[: int(B(2) * SR)], 0.9)
    roll = [B(21) + k * 0.5 * BEAT for k in range(4)] + [B(23) + k * 0.25 * BEAT for k in range(8)]
    for k, t in enumerate(roll):                           # clap roll into the drop: 8ths, then 16ths
        T.add(t, M.clap(0.2), 0.3 + 0.05 * k)
    T.add(B(21) - 0.05, M.whoosh(B(1) + 0.1), 1.0)
    T.add(B(22), M.riser(B(3)), 0.8)
    T.add(DROP, M.impact(), 0.9)
    # ending: final chord + hit on the freeze, ringing out
    T.add(B(31), M.kick(), 1.0)
    T.add(B(31), M.impact(2.4), 0.6)
    T.add(B(31), M.supersaw_chord(M.PROG[0][1], B(4) + 1.0, 2400), 0.9)
    T.add(B(31), M.sub(M.PROG[0][0] - 12, B(4)), 0.8)
    for w in cta.words:
        T.add(w["t"], M.pop(84 + 2 * w["i"]), 0.5)
    return M.reverb(T.buf, mix=0.12)


def build_audio():
    voice = tm.render_audio(src.audio)
    mus = build_music()[: len(voice)]
    mus = np.pad(mus, ((0, len(voice) - len(mus)), (0, 0)))
    duck = M.duck_curve(voice, depth_db=-9, thresh_db=-32)
    mix = voice * 1.4 + mus * 0.55 * duck[:, None]
    mix[-int(0.4 * SR):] *= np.linspace(1, 0, int(0.4 * SR))[:, None]   # short fade at the very end
    return M.master(mix).astype(np.float32)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", nargs=2, type=float)
    ap.add_argument("--out", default=os.path.join(HERE, "out", "v1.mp4"))
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    print(tm.describe())
    if words:
        with open(os.path.join(HERE, "words.md"), "w", encoding="utf-8") as fh:
            fh.write(word_table(words) + "\n")
    render(a.out, frame, tm.duration, audio=build_audio(), fps=FPS, size=(W, H), t_range=a.preview)
    pages = contact_sheet(a.out, a.out.replace(".mp4", "_contact"))
    print("\n".join([a.out] + pages))
