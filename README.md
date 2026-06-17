# Local Transcribe to Thai

A simple full-stack app for uploading an audio/video clip or pasting a YouTube URL, transcribing speech locally with `faster-whisper`, and translating the transcript into Thai with a local Hugging Face translation model.

## Project Structure

```text
frontend/
backend/
backend/main.py
backend/requirements.txt
README.md
```

## Requirements

- macOS
- Python 3.10 or 3.11 recommended
- Node.js 20 or newer
- FFmpeg
- yt-dlp
- Enough disk space for local model downloads

The default Whisper model is `small` on CPU with `int8` compute. The default translation model is `facebook/nllb-200-distilled-600M`, which is free and local after download, but can be large on first run.

## Backend Setup

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

If `python3.11` is not installed, use your installed Python 3.10+ executable:

```bash
python3 --version
python3 -m venv .venv
```

## FFmpeg Setup on macOS

Install Homebrew if needed, then install FFmpeg:

```bash
brew install ffmpeg
ffmpeg -version
```

The backend uses FFmpeg to normalize uploaded audio, extract audio from video files, and convert downloaded URL audio before transcription.

## yt-dlp Setup

`yt-dlp` is included in `backend/requirements.txt`, so `pip install -r requirements.txt` installs it into the virtual environment.

You can verify it with:

```bash
yt-dlp --version
```

YouTube downloading depends on `yt-dlp` and may fail for private, age-restricted, region-blocked, unavailable, copyrighted, or DRM-protected videos. Users are responsible for complying with platform terms and copyright laws.

## Frontend Setup

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and calls the backend at `http://localhost:8000` by default.

To point the frontend at a different backend URL:

```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

## Environment Variables

Backend variables can be set in your shell or in `backend/.env`. The FastAPI app loads `backend/.env` automatically.

```bash
WHISPER_MODEL_SIZE=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
TRANSLATION_MODEL=facebook/nllb-200-distilled-600M
TRANSLATION_MAX_CHUNK_CHARS=1200
CORS_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
VIDEO_MAX_DURATION_SECONDS=1800
VIDEO_MAX_FILE_SIZE=500M
YTDLP_TIMEOUT_SECONDS=600
YTDLP_SOCKET_TIMEOUT_SECONDS=20
```

Useful Whisper model sizes include `tiny`, `base`, `small`, `medium`, and `large-v3`. Larger models are more accurate but slower and require more memory.

## API

### Upload File

`POST /api/transcribe`

Accepts `multipart/form-data` with a `file` field.

Example response:

```json
{
  "source_type": "upload",
  "source_url": null,
  "video_title": null,
  "detected_language": "en",
  "transcript": "Hello, this is a test.",
  "translation_thai": "สวัสดี นี่คือการทดสอบ",
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text": "Hello, this is a test."
    }
  ]
}
```

### Paste Video URL

`POST /api/transcribe-url`

Accepts JSON:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Example curl request:

```bash
curl -X POST http://localhost:8000/api/transcribe-url \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID"}'
```

Example response:

```json
{
  "source_type": "url",
  "source_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "video_title": "Example video title",
  "detected_language": "en",
  "transcript": "Hello, this is a test.",
  "translation_thai": "สวัสดี นี่คือการทดสอบ",
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text": "Hello, this is a test."
    }
  ]
}
```

The URL endpoint currently accepts HTTPS YouTube hosts first, disables playlists, rejects livestreams/upcoming videos, and applies duration, size, socket timeout, and overall `yt-dlp` timeout safeguards.

## Troubleshooting

### FFmpeg is missing

If uploads fail with `FFmpeg is not installed or not available on PATH`, install it:

```bash
brew install ffmpeg
```

Then restart the backend terminal so the updated `PATH` is available.

### yt-dlp download failure

Make sure `yt-dlp` is installed in the active backend virtual environment:

```bash
yt-dlp --version
```

Private, unavailable, age-restricted, region-blocked, copyrighted, and DRM-protected videos may fail even when the URL is valid.

### Video too long or too large

Adjust these values in `backend/.env`:

```bash
VIDEO_MAX_DURATION_SECONDS=1800
VIDEO_MAX_FILE_SIZE=500M
YTDLP_TIMEOUT_SECONDS=600
```

### CPU inference is slow

The defaults are optimized for compatibility, not speed. Try:

```bash
WHISPER_MODEL_SIZE=tiny uvicorn main:app --reload --port 8000
```

For Apple Silicon, `faster-whisper` often still runs through CPU/CTranslate2. Keep `WHISPER_DEVICE=cpu` unless you have a supported GPU runtime configured.

### First request downloads large models

The first transcription downloads the Whisper model. The first translation downloads the translation model. This can take time and disk space. Later runs use the local Hugging Face and CTranslate2 caches.

To use a smaller or different Thai translation model, change `TRANSLATION_MODEL` and keep the adapter in `backend/translator.py` as the single swap point.

### Unsupported language translation quality

The app maps common Whisper language codes to NLLB language codes. If the detected language is not mapped, it falls back to English as the source language. Add more mappings in `ThaiTranslator.NLLB_CODES` in `backend/translator.py` for better multilingual support.

### CORS errors

Make sure the backend is running on port `8000` and the frontend is running on port `5173`. If you change ports, update `CORS_ALLOW_ORIGINS`.
