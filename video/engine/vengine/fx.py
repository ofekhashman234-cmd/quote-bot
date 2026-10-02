"""Frame effects: grade, vignette, flash, shake, zoom punches, rewind/VHS look."""
import math
import cv2
import numpy as np

from .comp import ease_out_cubic, clamp01


def make_grade(contrast=0.18, sat=1.14, warm=6, lift=4):
    """A per-channel LUT (S-curve contrast, warmth, black lift) + a saturation factor."""
    x = np.arange(256, dtype=np.float32) / 255
    s = x + contrast * (x - 0.5) * (1 - np.abs(2 * x - 1))          # gentle S-curve
    s = lift / 255 + s * (1 - lift / 255)
    luts = [np.clip((s * 255) + d, 0, 255).astype(np.uint8) for d in (warm, warm * 0.3, -warm)]
    return np.stack(luts, 1)[:, None, :], sat


def grade(img_u8, g):
    lut, sat = g
    out = cv2.LUT(img_u8, lut)
    if sat != 1.0:
        hsv = cv2.cvtColor(out, cv2.COLOR_RGB2HSV).astype(np.float32)
        hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255)
        out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)
    return out


_vig = {}


def vignette(frame, strength=0.28):
    H, W = frame.shape[:2]
    if (W, H, strength) not in _vig:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)) / 1.414
        _vig[(W, H, strength)] = (1 - strength * np.clip(r, 0, 1) ** 2.2)[..., None]
    frame *= _vig[(W, H, strength)]
    return frame


def flash(frame, k, color=(255, 255, 255)):
    """k: 0..1 flash amount."""
    if k > 0:
        frame *= 1 - k
        frame += np.array(color, np.float32) * k
    return frame


def shake(t, t0, dur=0.35, amp=22, freq=23):
    """(dx, dy, rot) offsets for a decaying camera shake that starts at t0."""
    if not (t0 <= t < t0 + dur):
        return 0.0, 0.0, 0.0
    k = (1 - (t - t0) / dur) ** 2
    return (amp * k * math.sin(2 * math.pi * freq * (t - t0)),
            amp * 0.7 * k * math.sin(2 * math.pi * freq * 1.37 * (t - t0) + 1.3),
            1.2 * k * math.sin(2 * math.pi * freq * 0.8 * (t - t0)))


def punch(t, t0, amount=0.12, dur=0.28):
    """Zoom-in punch that settles back: returns extra zoom (0 when idle)."""
    if not (t0 <= t < t0 + dur):
        return 0.0
    return amount * (1 - ease_out_cubic((t - t0) / dur))


def rgb_split(frame, px):
    if px < 0.5:
        return frame
    p = int(round(px))
    out = frame.copy()
    out[:, p:, 0] = frame[:, :-p, 0]
    out[:, :-p, 2] = frame[:, p:, 2]
    return out


def scanlines(frame, strength=0.18, t=0.0):
    H = frame.shape[0]
    rows = (np.arange(H) + int(t * 240)) % 6 < 2
    frame[rows] *= 1 - strength
    return frame


def tracking_noise(frame, t, rng_seed=0):
    """VHS tracking band that rolls through the picture."""
    H, W = frame.shape[:2]
    y = int((t * 1.7 % 1.0) * H)
    h = H // 14
    band = frame[y:y + h]
    if len(band):
        shift = int(40 * math.sin(t * 90))
        frame[y:y + h] = np.roll(band, shift, axis=1) * 0.85 + 30
    return frame
