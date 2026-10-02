"""Decoding the source once into memory-mappable caches (frames, timestamps, audio)."""
import json, os, subprocess
import numpy as np

AUDIO_SR = 48000


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


class Source:
    """A source clip decoded to a cache folder.

    frames.npy : uint8 [N, H, W, 3] RGB, already rotated upright (memmapped, shared by worker processes)
    pts.npy    : float64 [N] real presentation time of every frame (handles variable frame rate)
    audio.npy  : float32 [samples, 2] at 48 kHz
    """

    def __init__(self, path, cache_dir):
        self.path, self.cache = path, cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        if not os.path.exists(self._p("frames.npy")):
            self._decode()
        self.frames = np.load(self._p("frames.npy"), mmap_mode="r")
        self.pts = np.load(self._p("pts.npy"))
        self.audio = np.load(self._p("audio.npy"), mmap_mode="r")
        self.n, self.h, self.w = self.frames.shape[:3]
        self.duration = float(len(self.audio) / AUDIO_SR)
        self._mask = None

    def _p(self, name):
        return os.path.join(self.cache, name)

    def _decode(self):
        info = probe(self.path)
        v = next(s for s in info["streams"] if s["codec_type"] == "video")
        w, h = int(v["width"]), int(v["height"])
        rot = 0
        for sd in v.get("side_data_list", []):
            rot = int(sd.get("rotation", rot))
        if abs(rot) % 180 == 90:
            w, h = h, w
        pts = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time",
                              "-of", "csv=p=0", self.path], capture_output=True, text=True, check=True).stdout
        pts = np.array([float(x.strip().strip(",")) for x in pts.split() if x.strip().strip(",")])
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", self.path, "-fps_mode", "passthrough",
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        n = len(raw) // (w * h * 3)
        frames = np.lib.format.open_memmap(self._p("frames.npy"), "w+", np.uint8, (n, h, w, 3))
        frames[:] = np.frombuffer(raw, np.uint8)[: n * w * h * 3].reshape(n, h, w, 3)
        frames.flush()
        pts = pts[:n] - pts[0]
        np.save(self._p("pts.npy"), pts)
        a = subprocess.run(["ffmpeg", "-v", "error", "-i", self.path, "-vn", "-ac", "2", "-ar", str(AUDIO_SR),
                            "-f", "f32le", "-"], capture_output=True, check=True).stdout
        np.save(self._p("audio.npy"), np.frombuffer(a, np.float32).reshape(-1, 2))

    # --- frame access -------------------------------------------------------
    def index_at(self, t):
        """Index of the frame on screen at source time t."""
        i = int(np.searchsorted(self.pts, t, side="right") - 1)
        return min(max(i, 0), self.n - 1)

    def frame_at(self, t):
        return np.asarray(self.frames[self.index_at(t)])

    # --- person mask (see mask.py) ----------------------------------------
    @property
    def mask(self):
        if self._mask is None and os.path.exists(self._p("mask.npy")):
            self._mask = np.load(self._p("mask.npy"), mmap_mode="r")
        return self._mask

    def mask_at(self, t):
        """float32 [H, W] 0..1 alpha of the person at source time t (None if not computed)."""
        if self.mask is None:
            return None
        return np.asarray(self.mask[self.index_at(t)], np.float32) / 255.0
