import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import File, Form, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from schemas import ChunkTranscriptionResponse, TranscriptionResponse
from transcriber import WhisperTranscriber, extract_audio
from translator import ThaiTranslator


load_dotenv(Path(__file__).with_name(".env"))

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".mov", ".aac", ".flac", ".ogg", ".webm"}
CHUNK_EXTENSIONS = {".webm", ".ogg", ".wav", ".m4a", ".mp3", ".mp4"}

app = FastAPI(title="Local Transcribe and Thai Translate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

transcriber = WhisperTranscriber()
translator = ThaiTranslator()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe(file: UploadFile = File(...)) -> TranscriptionResponse:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {allowed}")

    with tempfile.TemporaryDirectory(prefix="transcribe-upload-") as temp_dir:
        temp_path = Path(temp_dir)
        uploaded_path = temp_path / f"upload{extension}"
        audio_path = temp_path / "audio.wav"

        try:
            with uploaded_path.open("wb") as output_file:
                shutil.copyfileobj(file.file, output_file)

            extract_audio(uploaded_path, audio_path)
            detected_language, transcript, segments = transcriber.transcribe(audio_path)
            translation_thai = translator.translate(transcript, detected_language)

            return TranscriptionResponse(
                source_type="upload",
                detected_language=detected_language,
                transcript=transcript,
                translation_thai=translation_thai,
                segments=segments,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except subprocess.CalledProcessError as exc:
            error_text = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else str(exc)
            raise HTTPException(status_code=500, detail=f"FFmpeg could not process this file: {error_text}") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
        finally:
            await file.close()


@app.post("/api/transcribe-chunk", response_model=ChunkTranscriptionResponse)
async def transcribe_chunk(
    file: UploadFile = File(...),
    chunk_id: Optional[str] = Form(default=None),
) -> ChunkTranscriptionResponse:
    extension = Path(file.filename or "").suffix.lower() or extension_from_content_type(file.content_type)
    if extension not in CHUNK_EXTENSIONS:
        allowed = ", ".join(sorted(CHUNK_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported audio chunk type. Allowed: {allowed}")

    resolved_chunk_id = chunk_id or str(uuid.uuid4())

    with tempfile.TemporaryDirectory(prefix="transcribe-chunk-") as temp_dir:
        temp_path = Path(temp_dir)
        chunk_path = temp_path / f"chunk{extension}"
        audio_path = temp_path / "audio.wav"

        try:
            with chunk_path.open("wb") as output_file:
                shutil.copyfileobj(file.file, output_file)

            extract_audio(chunk_path, audio_path)
            detected_language, transcript, segments = transcriber.transcribe(audio_path)
            translation_thai = translator.translate(transcript, detected_language) if transcript else ""

            return ChunkTranscriptionResponse(
                chunk_id=resolved_chunk_id,
                detected_language=detected_language,
                transcript=transcript,
                translation_thai=translation_thai,
                segments=segments,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except subprocess.CalledProcessError as exc:
            error_text = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else str(exc)
            raise HTTPException(status_code=500, detail=f"FFmpeg could not process this audio chunk: {error_text}") from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
        finally:
            await file.close()


def extension_from_content_type(content_type: Optional[str]) -> str:
    if content_type == "audio/webm" or content_type == "video/webm":
        return ".webm"
    if content_type == "audio/ogg":
        return ".ogg"
    if content_type == "audio/wav":
        return ".wav"
    if content_type == "audio/mp4":
        return ".m4a"
    return ""
