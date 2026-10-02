"""Original music + sound design synthesised with numpy/scipy (no licensing issues).

Everything is placed on a beat grid so cuts, text pops and hits land exactly on the music.
A Song is built from bar-level sections; each section turns instruments on/off.
"""
import numpy as np
from scipy.signal import butter, sosfilt

from .media import AUDIO_SR as SR

RNG = np.random.default_rng(7)


# ---- primitives ----------------------------------------------------------------------------
def _t(d):
    return np.arange(int(d * SR)) / SR


def _lp(x, hz, order=2):
    return sosfilt(butter(order, min(hz, SR / 2 - 100) / (SR / 2), "low", output="sos"), x)


def _hp(x, hz, order=2):
    return sosfilt(butter(order, hz / (SR / 2), "high", output="sos"), x)


def _bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo / (SR / 2), hi / (SR / 2)], "band", output="sos"), x)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def kick(d=0.42):
    t = _t(d)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = _hp(RNG.standard_normal(len(t)), 2500) * np.exp(-t * 300) * 0.25
    return np.tanh(1.6 * (body + click)) * 0.95


def clap(d=0.35):
    t = _t(d)
    n = _bp(RNG.standard_normal(len(t)), 900, 5200)
    env = np.zeros_like(t)
    for k, o in enumerate((0.0, 0.011, 0.022)):
        env += (t >= o) * np.exp(-(t - o).clip(0) * (120 if k < 2 else 16))
    return n * env * 0.55


def hat(d=0.05, open_=False):
    t = _t(0.22 if open_ else d)
    n = _hp(RNG.standard_normal(len(t)), 7000)
    return n * np.exp(-t * (14 if open_ else 90)) * (0.22 if open_ else 0.28)


def saw(f, t, detune=(0.0,)):
    out = 0
    for dt in detune:
        ff = f * 2 ** (dt / 1200)
        ph = (t * ff + RNG.random()) % 1.0
        out = out + (2 * ph - 1)
    return out / len(detune)


def supersaw_chord(notes, d, cutoff=2800):
    t = _t(d)
    x = sum(saw(midi(n), t, (-14, -6, 0, 7, 15)) for n in notes) / len(notes)
    env = np.minimum(1, t / 0.02) * np.exp(-t * 0.6)
    return _lp(x, cutoff) * env * 0.35


def pluck(n, d=0.28):
    t = _t(d)
    x = saw(midi(n), t, (-5, 5)) * 0.6 + np.sin(2 * np.pi * midi(n + 12) * t) * 0.4
    return _lp(x, 3800) * np.exp(-t * 11) * 0.38


def sub(n, d):
    t = _t(d)
    x = np.sin(2 * np.pi * midi(n) * t) + 0.25 * np.tanh(3 * np.sin(2 * np.pi * midi(n) * t))
    env = np.minimum(1, t / 0.008) * np.minimum(1, (d - t) / 0.03).clip(0)
    return x * env * 0.42


# ---- sound effects ---------------------------------------------------------------------------
def whoosh(d=0.5, up=True):
    t = _t(d)
    n = RNG.standard_normal(len(t))
    out = np.zeros_like(n)
    steps = 24
    for i in range(steps):  # moving band-pass
        a, b = i * len(t) // steps, (i + 1) * len(t) // steps
        k = i / steps if up else 1 - i / steps
        c = 300 + 6000 * k ** 2
        out[a:b] = _bp(n, c * 0.6, min(c * 1.6, 20000))[a:b]
    env = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    return out * env * 0.5


def riser(d=2.0):
    t = _t(d)
    n = RNG.standard_normal(len(t))
    out = np.zeros_like(n)
    steps = 40
    for i in range(steps):
        a, b = i * len(t) // steps, (i + 1) * len(t) // steps
        c = 400 + 9000 * (i / steps) ** 2
        out[a:b] = _bp(n, c * 0.7, min(c * 1.5, 20000))[a:b]
    tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / d) ** 2) / SR) * 0.15
    return (out * 0.35 + tone) * (t / d) ** 2


def impact(d=1.6):
    t = _t(d)
    f = 30 + 80 * np.exp(-t * 9)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.8)
    crash = _hp(RNG.standard_normal(len(t)), 3000) * np.exp(-t * 4) * 0.18
    return np.tanh(1.4 * boom) * 0.9 + crash


def pop(n=84, d=0.09):
    t = _t(d)
    f = midi(n) * (1 + 0.6 * np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 40) * 0.35


def rewind(d=0.5):
    """Tape-rewind chatter: fast, rising warble."""
    t = _t(d)
    f = 400 + 2600 * (t / d) + 300 * np.sin(2 * np.pi * 38 * t)
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.2
    x = _bp(x + 0.3 * RNG.standard_normal(len(t)), 600, 7000)
    return x * np.sin(np.pi * t / d) * 0.45


def tape_stop(x, d):
    """Slow a stereo buffer to a halt over its length (pitch falls to zero)."""
    n = len(x)
    rate = np.linspace(1, 0, n) ** 1.3
    pos = np.cumsum(rate)
    pos = np.clip(pos, 0, n - 1)
    return np.stack([np.interp(pos, np.arange(n), x[:, c]) for c in range(x.shape[1])], 1) * np.linspace(1, 0.3, n)[:, None]


def reverb(x, mix=0.18, decay=0.5):
    """Small Schroeder-style room (comb + allpass) — glues the synth parts together."""
    out = np.zeros_like(x)
    for dl, g in ((1557, 0.84), (1617, 0.83), (1491, 0.82), (1422, 0.81)):
        y = np.copy(x)
        dl = int(dl * SR / 44100)
        for i in range(dl, len(y), dl):
            y[i:i + dl] += y[i - dl:i][: len(y[i:i + dl])] * g * decay
        out += y
    out = _lp(out / 4, 6000)
    return x * (1 - mix) + out * mix


class Track:
    """A stereo buffer you drop sounds into by time."""

    def __init__(self, dur):
        self.buf = np.zeros((int(dur * SR) + SR, 2), np.float32)

    def add(self, t, x, gain=1.0, pan=0.0):
        if t < 0:
            x = x[int(-t * SR):]; t = 0
        i = int(round(t * SR))
        if x.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            x = np.stack([x * l * 1.414, x * r * 1.414], 1)
        n = min(len(x), len(self.buf) - i)
        if n > 0:
            self.buf[i:i + n] += (x[:n] * gain).astype(np.float32)
        return self


# ---- the song --------------------------------------------------------------------------------
PROG = [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [64, 67, 72]), (55, [67, 71, 74])]  # Am F C G
HOOK = [76, 79, 81, 79, 76, 74, 72, 74]   # 8th-note pluck motif over each bar
HOOK2 = [72, 76, 77, 76, 72, 71, 69, 71]


def bar_music(bpm, bar_idx, parts, cutoff=3000):
    """One bar (4 beats) of the groove with the given parts: kick, clap, hats, bass, chords, lead."""
    b = 60 / bpm
    T = Track(4 * b)
    root, chord = PROG[bar_idx % 4]
    if "chords" in parts:
        T.add(0, supersaw_chord(chord, 4 * b, cutoff), 0.9, 0.0)
    for k in range(8):
        t = k * b / 2
        if "kick" in parts and k % 2 == 0:
            T.add(t, kick())
        if "clap" in parts and k in (2, 6):
            T.add(t, clap(), 0.9)
        if "hats" in parts:
            T.add(t + (b / 2 if False else 0), hat(open_=(k % 2 == 1)), 0.8, 0.3 if k % 2 else -0.3)
        if "bass" in parts and k % 2 == 1:
            T.add(t, sub(root - 12, b / 2 * 0.9), 1.0)
        if "lead" in parts:
            motif = HOOK if bar_idx % 2 == 0 else HOOK2
            T.add(t, pluck(motif[k]), 0.8, -0.25 if k % 2 else 0.25)
            T.add(t + 3 * b / 4, pluck(motif[k]), 0.25, 0.6 if k % 2 else -0.6)   # dotted-8th echo
    x = T.buf[: int(4 * b * SR)]
    if "kick" in parts and "chords" in parts:   # sidechain pump on the chords/bass bus
        tt = (np.arange(len(x)) / SR) % b
        pump = 0.35 + 0.65 * np.clip(tt / (b * 0.55), 0, 1) ** 0.6
        x = x * pump[:, None] * 0.6 + x * 0.4
    return x


def duck_curve(voice, sr=SR, depth_db=-10, attack=0.03, release=0.35, thresh_db=-34):
    """Gain curve that dips the music when the voice is present."""
    mono = np.abs(voice).mean(1) if voice.ndim == 2 else np.abs(voice)
    win = int(0.03 * sr)
    env = np.sqrt(np.convolve(mono ** 2, np.ones(win) / win, "same"))
    on = (20 * np.log10(env + 1e-9) > thresh_db).astype(np.float32)
    g = np.ones_like(on)
    a, r = np.exp(-1 / (attack * sr)), np.exp(-1 / (release * sr))
    # smooth with separate attack/release (vectorised in blocks of 1 ms for speed)
    step = sr // 1000
    lvl, out = 0.0, np.empty(len(on[::step]), np.float32)
    for i, v in enumerate(on[::step]):
        k = a ** step if v > lvl else r ** step
        lvl = v + (lvl - v) * k
        out[i] = lvl
    lvl = np.repeat(out, step)[: len(on)]
    lvl = np.pad(lvl, (0, len(on) - len(lvl)), mode="edge")
    return 10 ** (depth_db * lvl / 20)


def master(x, ceiling=0.95):
    x = np.tanh(x * 1.2) / np.tanh(1.2)
    peak = np.abs(x).max() + 1e-9
    return x * min(1.0, ceiling / peak)
