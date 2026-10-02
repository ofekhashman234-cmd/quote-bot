"""Hebrew-safe text rendering: Pillow + RAQM layout (bidi + shaping). Never cv2.putText for Hebrew.

Text is rendered to an RGBA numpy tile, which compositing code places, scales and animates.
"""
from dataclasses import dataclass, field
from functools import lru_cache
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, features

assert features.check("raqm"), "Pillow was built without RAQM — Hebrew would render reversed"

FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "fonts")


@lru_cache(maxsize=64)
def font(name, size, weight=None):
    path = name if os.path.isabs(name) else os.path.join(FONT_DIR, name)
    f = ImageFont.truetype(path, int(size), layout_engine=ImageFont.Layout.RAQM)
    if weight is not None:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


@dataclass(frozen=True)
class TextStyle:
    font: str = "Rubik.ttf"
    size: int = 96
    weight: int | None = 800
    fill: tuple = (255, 255, 255, 255)
    stroke: int = 0
    stroke_fill: tuple = (0, 0, 0, 255)
    shadow: int = 0              # blur radius of a soft drop shadow (0 = none)
    shadow_offset: tuple = (0, 6)
    shadow_alpha: int = 150
    bg: tuple | None = None      # pill background colour
    bg_pad: tuple = (28, 10)     # x, y padding of the pill
    bg_radius: int = 26
    hard_shadow: tuple | None = None   # (dx, dy, (r, g, b, a)) solid offset copy behind the text
    stretch: float = 1.0               # horizontal scale (wider, poster-like letters)
    dots: float = 0.0                  # halftone dot texture strength on the fill (0..1)

    def replace(self, **kw):
        d = dict(self.__dict__); d.update(kw)
        return TextStyle(**d)


def _draw_kw(st):
    return dict(direction="rtl", language="he", features=["kern", "liga"])


def measure(text, st: TextStyle):
    """(width, height, ascent_offset) of the ink box of `text` laid out right-to-left."""
    f = font(st.font, st.size, st.weight)
    l, t, r, b = f.getbbox(text, stroke_width=st.stroke, **_draw_kw(st))
    return r - l, b - t, (l, t)


@lru_cache(maxsize=4096)
def render_text(text, st: TextStyle):
    """RGBA uint8 tile containing the text (with stroke/shadow/pill). Cached per (text, style)."""
    f = font(st.font, st.size, st.weight)
    # use the font's full line box so every word of a caption shares one baseline
    asc, desc = f.getmetrics()
    l, _, r, _ = f.getbbox(text, stroke_width=st.stroke, **_draw_kw(st))
    w, h = r - l, asc + desc + 2 * st.stroke
    px, py = st.bg_pad if st.bg else (0, 0)
    m = max(st.shadow * 3 + max(map(abs, st.shadow_offset)), 4) if st.shadow else 4
    W, H = w + 2 * (px + m), h + 2 * (py + m)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    origin = (m + px - l, m + py + st.stroke)
    if st.bg:
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([m, m, W - m, H - m], radius=st.bg_radius, fill=st.bg)
    if st.shadow:
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).text((origin[0] + st.shadow_offset[0], origin[1] + st.shadow_offset[1]), text, font=f,
                                fill=(0, 0, 0, st.shadow_alpha), stroke_width=st.stroke,
                                stroke_fill=(0, 0, 0, st.shadow_alpha), **_draw_kw(st))
        img = Image.alpha_composite(sh.filter(ImageFilter.GaussianBlur(st.shadow)), img)
    if st.hard_shadow:
        dx, dy, col = st.hard_shadow
        hs = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(hs).text((origin[0] + dx, origin[1] + dy), text, font=f, fill=col, stroke_width=st.stroke,
                                stroke_fill=col, **_draw_kw(st))
        img = Image.alpha_composite(img, hs)
    fg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(fg).text(origin, text, font=f, fill=st.fill, stroke_width=st.stroke,
                            stroke_fill=st.stroke_fill, **_draw_kw(st))
    if st.dots:
        fga = np.asarray(fg).astype(np.float32)
        per = max(4, st.size // 16)
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.hypot((xx % per) - per / 2, (yy % per) - per / 2) < per * 0.22
        fga[..., :3] *= np.where(d, 1 - 0.18 * st.dots, 1.0)[..., None]
        fg = Image.fromarray(fga.astype(np.uint8), "RGBA")
    img = Image.alpha_composite(img, fg)
    if st.stretch != 1.0:
        img = img.resize((max(1, int(round(W * st.stretch))), H), Image.LANCZOS)
    a = np.asarray(img)
    a.setflags(write=False)
    return a


def text_width(text, st):
    f = font(st.font, st.size, st.weight)
    l, _, r, _ = f.getbbox(text, stroke_width=st.stroke, **_draw_kw(st))
    return (r - l) * st.stretch


def space_width(st):
    return font(st.font, st.size, st.weight).getlength(" ") * 0.9 * st.stretch
