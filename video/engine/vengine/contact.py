"""Contact sheet for self-review: 6 frames per second of the finished video, each stamped with its time."""
import os, subprocess
import cv2
import numpy as np


def contact_sheet(video, out_prefix, per_sec=6, cols=6, rows=5, thumb_w=216):
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height",
                           "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip().split(",")
    w, h = int(info[0]), int(info[1])
    th = int(round(thumb_w * h / w)) // 2 * 2
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={per_sec},scale={thumb_w}:{th}",
                          "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, th, thumb_w, 3)
    per_page, pages = cols * rows, []
    for p0 in range(0, len(frames), per_page):
        sheet = np.full((rows * (th + 4), cols * (thumb_w + 4), 3), 24, np.uint8)
        for k, f in enumerate(frames[p0:p0 + per_page]):
            r, c = divmod(k, cols)
            y, x = r * (th + 4) + 2, c * (thumb_w + 4) + 2
            sheet[y:y + th, x:x + thumb_w] = f
            t = (p0 + k) / per_sec
            label = f"{t:5.2f}s"
            cv2.rectangle(sheet, (x, y), (x + 84, y + 24), (0, 0, 0), -1)
            cv2.putText(sheet, label, (x + 4, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        path = f"{out_prefix}_{len(pages) + 1:02d}.jpg"
        cv2.imwrite(path, sheet, [cv2.IMWRITE_JPEG_QUALITY, 88])
        pages.append(path)
    return pages
