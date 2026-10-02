"""Parallel renderer: one function t -> frame, rendered on all cores, piped into ffmpeg with the audio."""
import os, subprocess, sys, tempfile, time, wave
from multiprocessing import get_context

import numpy as np

from .media import AUDIO_SR

_FN = None


def _work(i_t):
    i, t = i_t
    f = _FN(t)
    return i, np.ascontiguousarray(np.clip(f, 0, 255).astype(np.uint8)).tobytes()


def write_wav(path, audio, sr=AUDIO_SR):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(pcm.shape[1]); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())


def render(out_path, frame_fn, duration, audio=None, fps=30, size=(1080, 1920), workers=None, crf=16,
           preset="slow", loudnorm=True, t_range=None):
    """frame_fn(t) -> float/uint8 RGB array of `size` (W, H). audio: float32 [n, 2] at 48 kHz.
    t_range=(a, b) renders only a slice (handy for quick previews)."""
    global _FN
    _FN = frame_fn
    W, H = size
    a, b = t_range or (0.0, duration)
    times = [(i, a + i / fps) for i in range(int(round((b - a) * fps)))]
    tmp = tempfile.mkdtemp()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
           "-r", str(fps), "-i", "-"]
    if audio is not None:
        wav = os.path.join(tmp, "a.wav")
        s0, s1 = int(a * AUDIO_SR), int(b * AUDIO_SR)
        write_wav(wav, audio[s0:s1])
        cmd += ["-i", wav]
    cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p", "-profile:v", "high",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-x264-params", "aq-mode=3", "-movflags", "+faststart"]
    if audio is not None:
        if loudnorm:
            cmd += ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000"]
        cmd += ["-c:a", "aac", "-b:a", "256k", "-shortest"]
    cmd += [out_path]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    workers = workers or os.cpu_count()
    with get_context("fork").Pool(workers) as pool:
        for k, (_, buf) in enumerate(pool.imap(_work, times, chunksize=2)):
            enc.stdin.write(buf)
            if k % 15 == 0 or k == len(times) - 1:
                el = time.time() - t0
                print(f"\rrender {k + 1}/{len(times)}  {(k + 1) / max(el, 1e-6):.1f} fps", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError("ffmpeg failed")
    return out_path
