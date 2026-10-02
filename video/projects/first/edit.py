"""Edit decision list for the first video. Everything is placed by source-time words (words.json),
then mapped through the TimeMap, so cuts, audio and effects stay in sync.

    python3 edit.py                 # full render + contact sheets
    python3 edit.py --preview 4 8   # quick render of output seconds 4..8
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "engine"))

import numpy as np
from vengine import Source, TimeMap, render, contact_sheet
from vengine.comp import cover
from vengine.timemap import cut_silences
from vengine.captions import Captions
from vengine.transcribe import transcribe, word_table

W, H, FPS = 1080, 1920, 30
LOOK = "bold"                                  # "clean" | "bold" — see vengine/captions.py

src = Source(os.path.join(HERE, "..", "..", "source.mov"), os.path.join(HERE, "cache"))
words = transcribe(src, os.path.join(HERE, "words.json"))

# ---- 1. time map: cut silences with soft crossfades ----------------------------------------
keep = cut_silences(words, src.duration, max_gap=0.35, pad_before=0.08, pad_after=0.12)
tm = TimeMap.keep(keep, xfade=0.08)

# ---- 2. layers ---------------------------------------------------------------------------
caps = Captions(words, tm, look=LOOK, W=W, H=H)


def base_frame(t_src):
    f = cover(src.frame_at(t_src), W, H).astype(np.float32)
    return f


def frame(t):
    srcs = tm.sources_at(t)
    f = sum(base_frame(ts) * w for ts, w in srcs)   # crossfade between pieces
    caps.draw(f, t)
    return f


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", nargs=2, type=float)
    ap.add_argument("--out", default=os.path.join(HERE, "out", "v1.mp4"))
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    print(tm.describe())
    with open(os.path.join(HERE, "words.md"), "w", encoding="utf-8") as fh:
        fh.write(word_table(words) + "\n")
    audio = tm.render_audio(src.audio)
    render(a.out, frame, tm.duration, audio=audio, fps=FPS, size=(W, H), t_range=a.preview)
    pages = contact_sheet(a.out, a.out.replace(".mp4", "_contact"))
    print("\n".join([a.out] + pages))
