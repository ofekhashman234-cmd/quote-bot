"""Title cards: words that pop in on chosen times (usually beats), optionally *behind* the person."""
from .comp import over, ease_out_back, ease_out_cubic, clamp01
from .text import render_text, text_width, space_width


class Title:
    def __init__(self, lines, times, style, y, start=None, end=None, W=1080, H=1920, behind=False,
                 line_gap=1.0, pop_from=0.3, pop_time=0.2, exit_time=0.15, tilt=0.0, x=0.5):
        """lines: list of strings; times: pop time per word (flattened, right-to-left reading order)."""
        self.style, self.behind, self.W, self.H = style, behind, W, H
        self.pop_from, self.pop_time, self.exit_time, self.tilt = pop_from, pop_time, exit_time, tilt
        self.words = []
        k = 0
        lh = style.size * line_gap
        y0 = y * H - (len(lines) - 1) * lh / 2
        sp = space_width(style)
        for li, line in enumerate(lines):
            ws = line.split()
            widths = [text_width(w, style) for w in ws]
            xx = x * W + (sum(widths) + sp * (len(ws) - 1)) / 2
            for w, ww in zip(ws, widths):
                self.words.append(dict(text=w, cx=xx - ww / 2, cy=y0 + li * lh, t=times[k], i=k))
                xx -= ww + sp; k += 1
        self.start = start if start is not None else min(times)
        self.end = end

    def active(self, t):
        return self.start <= t < (self.end if self.end is not None else 1e9)

    def draw(self, frame, t, matte=None):
        if not self.active(t):
            return frame
        kx = clamp01((self.end - t) / self.exit_time) if self.end is not None else 1.0
        for w in self.words:
            if t < w["t"]:
                continue
            k = (t - w["t"]) / self.pop_time
            s = (self.pop_from + (1 - self.pop_from) * ease_out_back(k, 2.2)) * (0.8 + 0.2 * kx)
            a = ease_out_cubic(k * 2) * kx
            rot = self.tilt * (1 if w["i"] % 2 else -1) * (1 - ease_out_cubic(k))
            over(frame, render_text(w["text"], self.style), w["cx"], w["cy"], scale=s, rot=rot, alpha=a,
                 matte=matte if self.behind else None)
        return frame
