"""Compositing helpers. Frames are float32 [H, W, 3] in 0..255 throughout the pipeline."""
import math
import cv2
import numpy as np


def cover(img, W, H, zoom=1.0, cx=0.5, cy=0.5, interp=cv2.INTER_CUBIC):
    """Scale `img` to fill W x H (crop the overflow), with optional zoom/pan around (cx, cy)."""
    h, w = img.shape[:2]
    s = max(W / w, H / h) * zoom
    M = np.float32([[s, 0, W / 2 - cx * w * s], [0, s, H / 2 - cy * h * s]])
    return cv2.warpAffine(img, M, (W, H), flags=interp, borderMode=cv2.BORDER_REFLECT)


def over(frame, tile, cx, cy, scale=1.0, rot=0.0, alpha=1.0, anchor=(0.5, 0.5), matte=None):
    """Alpha-composite an RGBA uint8 tile onto `frame` in place.
    (cx, cy) is where the tile's anchor point lands; rot in degrees; matte (H x W, 0..1) multiplies
    the tile's alpha — pass (1 - person_mask) to put the tile *behind* the person."""
    if alpha <= 0.003 or scale <= 0.01:
        return frame
    th, tw = tile.shape[:2]
    ax, ay = anchor[0] * tw, anchor[1] * th
    c, s = math.cos(math.radians(rot)) * scale, math.sin(math.radians(rot)) * scale
    M = np.float32([[c, s, cx - (c * ax + s * ay)], [-s, c, cy - (-s * ax + c * ay)]])
    corners = np.array([[0, 0, 1], [tw, 0, 1], [0, th, 1], [tw, th, 1]], np.float32) @ M.T
    H, W = frame.shape[:2]
    x0, y0 = np.floor(corners.min(0)).astype(int) - 1
    x1, y1 = np.ceil(corners.max(0)).astype(int) + 1
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    if x1 <= x0 or y1 <= y0:
        return frame
    M[:, 2] -= (x0, y0)
    roi = cv2.warpAffine(tile, M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0)).astype(np.float32)
    a = roi[..., 3:4] / 255.0 * alpha
    if matte is not None:
        a = a * matte[y0:y1, x0:x1, None]
    dst = frame[y0:y1, x0:x1]
    dst *= 1 - a
    dst += roi[..., :3] * a
    return frame


# ---- easing -----------------------------------------------------------------
def clamp01(x):
    return min(max(x, 0.0), 1.0)


def ease_out_cubic(x):
    x = clamp01(x); return 1 - (1 - x) ** 3


def ease_in_cubic(x):
    x = clamp01(x); return x ** 3


def ease_out_back(x, k=1.7):
    x = clamp01(x); return 1 + (k + 1) * (x - 1) ** 3 + k * (x - 1) ** 2


def smoothstep(x):
    x = clamp01(x); return x * x * (3 - 2 * x)
