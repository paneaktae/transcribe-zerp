import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from schemas import TranscribeUrlRequest, TranscriptionResponse
from transcriber import WhisperTranscriber, extract_audio
from translator import ThaiTranslator
from video_downloader import (
    UnsupportedUrlError,
    VideoDownloadError,
    VideoTooLargeError,
    VideoTooLongError,
    VideoUnavailableError,
    download_audio_from_url,
)


load_dotenv(Path(__file__).with_name(".env"))

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".mov", ".aac", ".flac", ".ogg", ".webm"}

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


@app.post("/api/transcribe-url", response_model=TranscriptionResponse)
def transcribe_url(payload: TranscribeUrlRequest) -> TranscriptionResponse:
    with tempfile.TemporaryDirectory(prefix="transcribe-url-") as temp_dir:
        temp_path = Path(temp_dir)
        audio_path = temp_path / "audio.wav"

        try:
            downloaded = download_audio_from_url(str(payload.url), temp_path)
            extract_audio(downloaded.audio_path, audio_path)
            detected_language, transcript, segments = transcriber.transcribe(audio_path)
            translation_thai = translator.translate(transcript, detected_language)

            return TranscriptionResponse(
                source_type="url",
                source_url=downloaded.source_url,
                video_title=downloaded.title,
                detected_language=detected_language,
                transcript=transcript,
                translation_thai=translation_thai,
                segments=segments,
            )
        except UnsupportedUrlError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except VideoTooLongError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except VideoTooLargeError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except VideoUnavailableError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except subprocess.CalledProcessError as exc:
            error_text = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else str(exc)
            raise HTTPException(status_code=500, detail=f"FFmpeg could not process downloaded audio: {error_text}") from exc
        except VideoDownloadError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc
