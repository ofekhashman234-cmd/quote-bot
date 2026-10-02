# vengine — video editing engine

Every output frame is composed in Python (OpenCV + numpy); Hebrew text is drawn with Pillow + RAQM;
ffmpeg encodes picture and sound together.

| module | role |
|---|---|
| `media.py` | decodes the source once: frames (memmap), real per-frame timestamps (VFR-safe), 48 kHz audio |
| `transcribe.py` | ivrit.ai Hebrew Whisper (large-v3-turbo) → `words.json` with per-word start/end |
| `timemap.py` | source ↔ output time: kept clips, freeze frames, soft crossfades; cuts the audio with the same map; `cut_silences()` |
| `mask.py` | person matte per frame (rembg `u2net_human_seg`), cached to `mask.npy` |
| `text.py` / `comp.py` | Hebrew text tiles, alpha compositing (scale/rotate/behind-person), easing |
| `captions.py` | animated word-by-word captions (`clean` / `bold` looks) |
| `render.py` | `frame(t)` on all cores → libx264 CRF 16 + AAC, loudness −14 LUFS |
| `contact.py` | self-review sheets: 6 frames per second, time stamped |

Workflow: `./setup.sh` once, put the clip at `source.mov`, then `python3 projects/<name>/edit.py`
(`--preview A B` renders only output seconds A..B).
