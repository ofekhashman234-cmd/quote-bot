"""Word-level transcription with ivrit.ai's Hebrew Whisper (large-v3-turbo), run locally on CPU.

Uses faster-whisper with the CTranslate2 build of the model (ivrit-ai/whisper-large-v3-turbo-ct2).
The model folder is looked up in $IVRIT_MODEL or ~/tools/models/ivrit-large-v3-turbo-ct2.
"""
import json, os

DEFAULT_MODEL = os.environ.get("IVRIT_MODEL", os.path.expanduser("~/tools/models/ivrit-large-v3-turbo-ct2"))
if not os.path.isdir(DEFAULT_MODEL):
    DEFAULT_MODEL = "ivrit-ai/whisper-large-v3-turbo-ct2"   # downloads from Hugging Face


def transcribe(src, out_json, model=DEFAULT_MODEL, language="he"):
    if os.path.exists(out_json):
        return json.load(open(out_json, encoding="utf-8"))
    import subprocess, tempfile
    from faster_whisper import WhisperModel
    wav = os.path.join(tempfile.mkdtemp(), "a.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src.path, "-ac", "1", "-ar", "16000", wav], check=True)
    m = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=os.cpu_count())
    segs, _ = m.transcribe(wav, language=language, word_timestamps=True, beam_size=5, vad_filter=False,
                           condition_on_previous_text=False)
    words = []
    for s in segs:
        for w in s.words or []:
            t = w.word.strip()
            if t:
                words.append({"i": len(words), "text": t, "start": round(w.start, 3), "end": round(w.end, 3),
                              "p": round(w.probability, 3)})
    json.dump(words, open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return words


def word_table(words):
    rows = ["| # | מילה | התחלה (ש׳) | סוף (ש׳) |", "|---|---|---|---|"]
    rows += [f"| {w['i']} | {w['text']} | {w['start']:.2f} | {w['end']:.2f} |" for w in words]
    return "\n".join(rows)
