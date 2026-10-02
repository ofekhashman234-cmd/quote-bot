"""Person segmentation: rembg + u2net_human_seg, computed once per source frame and cached to mask.npy."""
import os, sys
import numpy as np


def _work(args):
    path, i0, i1 = args
    from rembg import new_session, remove
    from PIL import Image
    frames = np.load(path, mmap_mode="r")
    sess = new_session("u2net_human_seg")
    out = []
    for i in range(i0, i1):
        m = remove(Image.fromarray(np.asarray(frames[i])), session=sess, only_mask=True,
                   post_process_mask=False)
        out.append(np.asarray(m, np.uint8))
    return i0, np.stack(out)


def compute_mask(src, workers=None, chunk=24):
    dst = os.path.join(src.cache, "mask.npy")
    if os.path.exists(dst):
        return
    from multiprocessing import get_context
    workers = workers or os.cpu_count()
    fpath = os.path.join(src.cache, "frames.npy")
    jobs = [(fpath, i, min(i + chunk, src.n)) for i in range(0, src.n, chunk)]
    tmp = dst + ".part.npy"
    masks = np.lib.format.open_memmap(tmp, "w+", np.uint8, (src.n, src.h, src.w))
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    with get_context("spawn").Pool(workers) as pool:
        for k, (i0, m) in enumerate(pool.imap_unordered(_work, jobs)):
            masks[i0:i0 + len(m)] = m
            print(f"\rmask {min((k + 1) * chunk, src.n)}/{src.n}", end="", file=sys.stderr, flush=True)
    print(file=sys.stderr)
    masks.flush(); del masks
    _smooth(tmp)
    os.replace(tmp, dst)


def _smooth(path):
    """Light temporal smoothing so the matte doesn't flicker frame to frame."""
    m = np.load(path, mmap_mode="r+")
    prev = m[0].astype(np.float32)
    for i in range(1, len(m)):
        cur = m[i].astype(np.float32)
        # follow fast motion fully, damp small jitter
        a = np.where(np.abs(cur - prev) > 60, 1.0, 0.6)
        prev = a * cur + (1 - a) * prev
        m[i] = prev.astype(np.uint8)
    m.flush()
