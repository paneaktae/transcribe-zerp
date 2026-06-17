import os
import shutil
import subprocess
from pathlib import Path
from typing import List

from schemas import RawSegment


class WhisperTranscriber:
    def __init__(self) -> None:
        self._model = None

    @property
    def model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            model_size = os.getenv("WHISPER_MODEL_SIZE", "small")
            device = os.getenv("WHISPER_DEVICE", "cpu")
            compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
            self._model = WhisperModel(model_size, device=device, compute_type=compute_type)
        return self._model

    def transcribe(self, audio_path: Path) -> tuple[str, str, List[RawSegment]]:
        segments_iter, info = self.model.transcribe(
            str(audio_path),
            beam_size=5,
            vad_filter=True,
            word_timestamps=False,
        )
        segments = [
            RawSegment(start=round(segment.start, 2), end=round(segment.end, 2), text=segment.text.strip())
            for segment in segments_iter
        ]
        transcript = " ".join(segment.text for segment in segments).strip()
        detected_language = getattr(info, "language", None) or "unknown"
        return detected_language, transcript, segments


def extract_audio(input_path: Path, output_path: Path) -> None:
    if shutil.which("ffmpeg") is None:
        raise FileNotFoundError("FFmpeg is not installed or not available on PATH.")

    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(output_path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
