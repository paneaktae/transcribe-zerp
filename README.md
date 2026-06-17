# Local Transcribe to Thai

A simple full-stack app for uploading audio/video files or live-translating a YouTube video while it plays in the browser. Speech is transcribed locally with `faster-whisper` and translated into Thai with a local Hugging Face translation model.

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
- Enough disk space for local model downloads

The default Whisper model is `small` on CPU with `int8` compute. The default translation model is `facebook/nllb-200-distilled-600M`, which is free and local after download, but can be large on first run.

## Translation Pipeline

After transcription, the backend normalizes the detected language from faster-whisper and uses a two-step translation pipeline:

- English audio: original transcript -> Thai
- Non-English audio: original transcript -> English -> Thai
- Unknown language: attempts original transcript -> English -> Thai and returns a warning

The English intermediate is returned so users can inspect the pivot text before the Thai translation. This is useful because multilingual models often produce more consistent Thai output when non-English speech is routed through English first, and it gives a readable checkpoint for debugging translation quality.

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

The backend uses FFmpeg to normalize uploaded files and browser-recorded audio chunks before transcription.

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

## Live YouTube Translation

The app does not download YouTube videos and does not use `yt-dlp` for live video translation.

Browsers generally do not allow a web app to directly read audio from an embedded YouTube iframe because of cross-origin and media security restrictions. The supported workflow uses browser tab audio capture:

1. Paste a YouTube URL in `Live video translation`.
2. Play the video in the embedded player.
3. Click `Start live translation`.
4. In the browser picker, choose the current tab or the tab containing the video.
5. Enable `Share tab audio`.

The app records small tab-audio chunks with `MediaRecorder`, sends them to `POST /api/transcribe-chunk`, and appends transcript and Thai translation as chunks finish.

Chrome and Edge generally support tab audio capture. Safari and Firefox support may be limited. If tab audio is unavailable, use the microphone fallback, play the video through speakers, and expect lower audio quality.

## Deployment

Deploy the frontend and backend separately.

The Vite frontend can run on Vercel. The FastAPI backend should run on a server or container platform that supports:

- long-running Python processes
- FFmpeg
- large model downloads
- enough CPU and memory for `faster-whisper` and the translation model

Vercel serverless functions are not a good fit for this backend because speech transcription and translation can take longer than typical serverless limits and require large local model files.

### Deploy Frontend to Vercel

From the frontend folder:

```bash
cd frontend
npm install
npm run build
npx vercel deploy --prod
```

If the backend is already deployed, set the production frontend environment variable before deploying:

```bash
VITE_API_URL=https://your-fastapi-backend.example.com npm run build
```

The deployed frontend also includes a `Backend API URL` field. Paste the public FastAPI backend URL there if `VITE_API_URL` was not set at build time.

### Deploy Backend as a Container

The backend includes [backend/Dockerfile](backend/Dockerfile). Build and run it locally:

```bash
cd backend
docker build -t transcribe-zerp-backend .
docker run --rm -p 8000:8000 \
  -e CORS_ALLOW_ORIGINS=https://transcribe-zerp.vercel.app \
  transcribe-zerp-backend
```

Deploy the same Dockerfile to a container host such as Fly.io, Railway, Render, a VPS, or another service that can run CPU-heavy containers. Set:

```bash
CORS_ALLOW_ORIGINS=https://transcribe-zerp.vercel.app
WHISPER_MODEL_SIZE=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

After the backend has a public HTTPS URL, enter it in the frontend `Backend API URL` field or redeploy the frontend with `VITE_API_URL` set to that URL.

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
  "transcript_original": "Hello, this is a test.",
  "transcript_english": "Hello, this is a test.",
  "translation_thai": "สวัสดี นี่คือการทดสอบ",
  "translation_path": "original_to_thai",
  "warnings": [],
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text_original": "Hello, this is a test.",
      "text_english": "Hello, this is a test.",
      "text_thai": "สวัสดี นี่คือการทดสอบ"
    }
  ]
}
```

### Transcribe Audio Chunk

`POST /api/transcribe-chunk`

Accepts `multipart/form-data`:

- `file`: browser-recorded audio chunk, usually WebM/Opus
- `chunk_id`: optional chunk identifier

Example response:

```json
{
  "chunk_id": "chunk-123",
  "detected_language": "en",
  "transcript_original": "Hello from this audio chunk.",
  "transcript_english": "Hello from this audio chunk.",
  "translation_thai": "สวัสดีจากส่วนเสียงนี้",
  "translation_path": "original_to_thai",
  "warnings": [],
  "segments": [
    {
      "start": 0.0,
      "end": 4.2,
      "text_original": "Hello from this audio chunk.",
      "text_english": "Hello from this audio chunk.",
      "text_thai": "สวัสดีจากส่วนเสียงนี้"
    }
  ]
}
```

## Troubleshooting

### FFmpeg is missing

If uploads or live chunks fail with `FFmpeg is not installed or not available on PATH`, install it:

```bash
brew install ffmpeg
```

Then restart the backend terminal so the updated `PATH` is available.

### Tab Audio Capture Is Missing

Use Chrome or Edge where possible. When the browser asks what to share, choose the current tab or the tab containing the video and enable `Share tab audio`. The app cannot directly read audio from the YouTube iframe.

### Microphone Fallback Sounds Bad

Microphone capture records room audio. Increase speaker volume, reduce background noise, and keep the microphone close to the speaker. Tab audio capture is preferred.

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
