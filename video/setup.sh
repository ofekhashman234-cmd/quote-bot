#!/usr/bin/env bash
# One-time setup of the video engine's dependencies.
set -euo pipefail
# Python libs: OpenCV/numpy for frames, Pillow (with RAQM) for Hebrew text, rembg for the person mask,
# faster-whisper to run ivrit.ai's Hebrew transcription model on CPU.
pip install -q opencv-python-headless numpy pillow "rembg[cpu]" faster-whisper huggingface_hub
python3 -c "from PIL import features; assert features.check('raqm'), 'Pillow lacks RAQM (install libraqm/libfribidi)'"
# Person segmentation model used by rembg
mkdir -p ~/.u2net
[ -f ~/.u2net/u2net_human_seg.onnx ] || curl -sSL -o ~/.u2net/u2net_human_seg.onnx \
  https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx
# ivrit.ai Hebrew Whisper (large-v3-turbo, CTranslate2 build) — needs huggingface.co + *.hf.co reachable
M=~/tools/models/ivrit-large-v3-turbo-ct2
[ -f "$M/model.bin" ] || python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('ivrit-ai/whisper-large-v3-turbo-ct2', local_dir='$M')"
