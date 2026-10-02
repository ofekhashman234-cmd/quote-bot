"""Animated word-by-word Hebrew captions, timed from the word table through the TimeMap."""
from dataclasses import dataclass, field
import re

from .comp import over, ease_out_back, ease_out_cubic, ease_in_cubic, clamp01
from .text import TextStyle, render_text, text_width, space_width


@dataclass
class CaptionLook:
    base: TextStyle                       # words already spoken / waiting
    active: TextStyle                     # the word being said right now
    y: float = 0.72                       # vertical centre of the block (fraction of frame height)
    max_width: float = 0.84               # wrap width (fraction of frame width)
    max_words: int = 3
    max_chars: int = 16
    line_gap: float = 1.05
    reveal: bool = True                   # words appear as they are spoken (False: whole page at once)
    pop_from: float = 0.55                # starting scale of a word's pop-in
    pop_time: float = 0.16
    rise: float = 18                      # px a word rises while popping in
    tilt: float = 0.0                     # degrees of playful rotation per word (alternating)
    exit_time: float = 0.12
    lead: float = 0.04                    # show a word slightly before its sound
    hold: float = 0.45                    # how long the last page stays after the last word


MINT, BLUE, INK = (226, 238, 232, 255), (64, 156, 202, 255), (16, 38, 52, 255)
_POSTER = TextStyle(font="Rubik.ttf", size=112, weight=900, fill=MINT, stretch=1.08, dots=1.0,
                    hard_shadow=(0, 9, BLUE), shadow=10, shadow_alpha=150, shadow_offset=(0, 10))

LOOKS = {
    # Poster — the font look from the reference image: heavy square Hebrew, mint with halftone dots,
    # solid blue drop; the word being said flips to blue with a mint drop. No background box.
    "poster": CaptionLook(
        base=_POSTER,
        active=_POSTER.replace(fill=BLUE, hard_shadow=(0, 9, MINT)),
        y=0.78, pop_from=0.4, pop_time=0.17, rise=30, tilt=3.0, max_words=2, max_chars=12, reveal=True),
    # A — clean & minimal: white, soft shadow, active word in accent colour, gentle rise
    "clean": CaptionLook(
        base=TextStyle(font="Rubik.ttf", size=84, weight=700, fill=(255, 255, 255, 255), shadow=10,
                       shadow_alpha=170, shadow_offset=(0, 4)),
        active=TextStyle(font="Rubik.ttf", size=84, weight=700, fill=(255, 214, 102, 255), shadow=10,
                         shadow_alpha=170, shadow_offset=(0, 4)),
        y=0.79, pop_from=0.85, pop_time=0.2, rise=14, max_words=3, reveal=True),
    # B — bold & energetic: heavy font, thick outline, active word turns pink (no background), springy pop
    "bold": CaptionLook(
        base=TextStyle(font="Rubik.ttf", size=104, weight=900, fill=(255, 255, 255, 255), stroke=9,
                       stroke_fill=(17, 17, 17, 255), shadow=6, shadow_alpha=120, shadow_offset=(0, 8)),
        active=TextStyle(font="Rubik.ttf", size=104, weight=900, fill=(255, 79, 154, 255), stroke=9,
                         stroke_fill=(17, 17, 17, 255), shadow=6, shadow_alpha=120, shadow_offset=(0, 8)),
        y=0.79,
        pop_from=0.45, pop_time=0.16, rise=26, tilt=2.5, max_words=2, max_chars=12, reveal=True),
}

_PUNCT_END = re.compile(r"[.!?,…:]$")


def paginate(words, look: CaptionLook, gap_break=0.45):
    """Group words into caption pages: limited words/characters, break on pauses and punctuation."""
    pages, cur = [], []
    for w in words:
        if cur:
            chars = sum(len(x["text"]) for x in cur) + len(w["text"])
            if (len(cur) >= look.max_words or chars > look.max_chars or w["out_start"] - cur[-1]["out_end"] > gap_break
                    or _PUNCT_END.search(cur[-1]["text"])):
                pages.append(cur); cur = []
        cur.append(w)
    if cur:
        pages.append(cur)
    for i, p in enumerate(pages):
        start = p[0]["out_start"] - look.lead
        nxt = pages[i + 1][0]["out_start"] - look.lead if i + 1 < len(pages) else None
        end = p[-1]["out_end"] + look.hold
        if nxt is not None:
            end = min(end, nxt)
        pages[i] = {"words": p, "start": start, "end": max(end, start + 0.3)}
    return pages


class Captions:
    def __init__(self, words, timemap, look="clean", W=1080, H=1920):
        self.look = LOOKS[look] if isinstance(look, str) else look
        self.W, self.H = W, H
        ws = []
        for w in words:
            if not timemap.is_kept(0.5 * (w["start"] + w["end"])):
                continue  # the word itself was cut out
            ws.append(dict(w, out_start=timemap.to_out(w["start"]), out_end=timemap.to_out(w["end"])))
        self.pages = paginate(ws, self.look)
        for p in self.pages:
            self._layout(p)

    def _layout(self, page):
        """Right-to-left line layout; each word gets a fixed slot (centre x, y)."""
        L, st = self.look, self.look.base
        maxw = L.max_width * self.W
        sp = space_width(st) + 2 * st.stroke
        lines, line, lw = [], [], 0
        for w in page["words"]:
            ww = text_width(w["text"], st)
            if line and lw + sp + ww > maxw:
                lines.append((line, lw)); line, lw = [], 0
            lw += (sp if line else 0) + ww
            line.append((w, ww))
        lines.append((line, lw))
        lh = st.size * L.line_gap
        y0 = L.y * self.H - (len(lines) - 1) * lh / 2
        for li, (line, lw) in enumerate(lines):
            x = self.W / 2 + lw / 2          # start at the right edge: Hebrew reads right-to-left
            for w, ww in line:
                w["cx"], w["cy"] = x - ww / 2, y0 + li * lh
                x -= ww + sp

    def draw(self, frame, t):
        L = self.look
        for p in self.pages:
            if not (p["start"] <= t < p["end"]):
                continue
            k_exit = clamp01((p["end"] - t) / L.exit_time)
            exit_s = 0.85 + 0.15 * ease_out_cubic(k_exit)
            for i, w in enumerate(p["words"]):
                t0 = w["out_start"] - L.lead if L.reveal else p["start"]
                if t < t0:
                    continue
                k = (t - t0) / L.pop_time
                s = (L.pop_from + (1 - L.pop_from) * ease_out_back(k)) * exit_s
                a = ease_out_cubic(k * 1.6) * ease_out_cubic(k_exit)
                dy = L.rise * (1 - ease_out_cubic(k))
                active = w["out_start"] - L.lead <= t < max(w["out_end"], w["out_start"] + 0.12)
                st = L.active if active else L.base
                tile = render_text(w["text"], st)
                rot = L.tilt * (1 if i % 2 else -1) if active else 0.0
                over(frame, tile, w["cx"], w["cy"] + dy, scale=s, rot=rot, alpha=a)
        return frame
