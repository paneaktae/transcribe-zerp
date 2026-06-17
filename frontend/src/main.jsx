import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Clipboard, Download, FileAudio, Link, Loader2, Mic, MonitorUp, Pause, Play, Square, Trash2, Upload, X } from 'lucide-react';
import './styles.css';

const LOCAL_API_URL = 'http://localhost:8000';
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const DEFAULT_API_URL = import.meta.env.VITE_API_URL || (isLocalHost ? LOCAL_API_URL : '');
const ACCEPTED_TYPES = '.mp3,.wav,.m4a,.mp4,.mov,.aac,.flac,.ogg,.webm,audio/*,video/*';
const CHUNK_MS = 7000;

function App() {
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunkCounterRef = useRef(0);
  const seenChunkTextRef = useRef(new Set());

  const [mode, setMode] = useState('upload');
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [autoplayToken, setAutoplayToken] = useState(0);
  const [captureWarning, setCaptureWarning] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [liveResult, setLiveResult] = useState(emptyLiveResult());
  const [liveCaptureActive, setLiveCaptureActive] = useState(false);
  const [copied, setCopied] = useState('');
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('transcribe-api-url') || DEFAULT_API_URL);

  const statusLabel = useMemo(() => {
    const labels = {
      idle: 'Ready',
      uploading: 'Uploading file',
      extracting: 'Extracting audio',
      transcribing: 'Transcribing',
      translating: 'Translating',
      complete: 'Complete',
      waiting_permission: 'Waiting for tab audio permission',
      recording: 'Recording',
      sending_chunk: 'Sending chunk',
      stopped: 'Stopped',
      paused: 'Paused',
      permission_denied: 'Permission denied',
      unsupported: 'Unsupported browser',
      error: 'Needs attention',
    };
    return labels[status] || 'Processing';
  }, [status]);

  const isUploading = mode === 'upload' && ['uploading', 'extracting', 'transcribing', 'translating'].includes(status);
  const isRecording = liveCaptureActive || ['waiting_permission', 'recording', 'sending_chunk'].includes(status);
  const controlsDisabled = isUploading || isRecording;
  const youtubeEmbedUrl = getYouTubeEmbedUrl(videoUrl, autoplayToken);

  function switchMode(nextMode) {
    if (controlsDisabled) return;
    setMode(nextMode);
    setError('');
    setStatus('idle');
  }

  function handleFileChange(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError('');
    setResult(null);
    setStatus('idle');
  }

  async function submitFile() {
    const backendUrl = getBackendUrl(apiUrl);
    if (!backendUrl) {
      setError('Set a public FastAPI backend URL before transcribing.');
      setStatus('error');
      return;
    }
    if (!file) {
      setError('Choose an audio or video file first.');
      setStatus('error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setError('');
    setResult(null);
    setStatus('uploading');

    try {
      const responsePromise = fetch(`${backendUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });

      setStatus('extracting');
      window.setTimeout(() => setStatus((current) => (current === 'extracting' ? 'transcribing' : current)), 900);
      window.setTimeout(() => setStatus((current) => (current === 'transcribing' ? 'translating' : current)), 2200);

      const data = await readJsonResponse(await responsePromise);
      setResult(data);
      setStatus('complete');
    } catch (requestError) {
      setError(formatRequestError(requestError, backendUrl));
      setStatus('error');
    }
  }

  async function startTabCapture() {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setError('This browser does not support tab audio capture. Try Chrome or Edge, or use microphone fallback.');
      setStatus('unsupported');
      return;
    }

    setCaptureWarning('Select this browser tab and enable tab audio sharing.');
    setStatus('waiting_permission');
    setError('');

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      beginRecording(stream, 'tab');
    } catch (captureError) {
      setStatus('permission_denied');
      setError(captureError?.name === 'NotAllowedError' ? 'Tab audio permission was denied.' : captureError.message || 'Could not start tab audio capture.');
    }
  }

  async function startMicrophoneCapture() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('This browser does not support microphone recording.');
      setStatus('unsupported');
      return;
    }

    setCaptureWarning('Microphone fallback is lower quality. Play the video through speakers and keep the microphone near the audio.');
    setStatus('waiting_permission');
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      beginRecording(stream, 'microphone');
    } catch (captureError) {
      setStatus('permission_denied');
      setError(captureError?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : captureError.message || 'Could not start microphone capture.');
    }
  }

  function beginRecording(stream, source) {
    stopLiveTranslation({ keepStatus: true });
    streamRef.current = stream;
    setLiveCaptureActive(true);

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      setCaptureWarning('No audio track was detected. Start again and enable Share tab audio, or use microphone fallback.');
    } else if (source === 'tab') {
      setCaptureWarning('Recording tab audio. Do not mute the tab while translating.');
    }

    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        sendChunk(event.data);
      }
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start(CHUNK_MS);
    setStatus('recording');
  }

  function pauseLiveTranslation() {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') {
      recorder.pause();
      setStatus('paused');
      setLiveCaptureActive(true);
    }
  }

  function resumeLiveTranslation() {
    const recorder = recorderRef.current;
    if (recorder?.state === 'paused') {
      recorder.resume();
      setStatus('recording');
      setLiveCaptureActive(true);
    }
  }

  function stopLiveTranslation(options = {}) {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setLiveCaptureActive(false);
    if (!options.keepStatus) setStatus('stopped');
  }

  async function sendChunk(blob) {
    const backendUrl = getBackendUrl(apiUrl);
    if (!backendUrl) {
      setError('Set a public FastAPI backend URL before starting live translation.');
      stopLiveTranslation();
      return;
    }

    const chunkId = `chunk-${Date.now()}-${chunkCounterRef.current++}`;
    const formData = new FormData();
    formData.append('chunk_id', chunkId);
    formData.append('file', blob, `${chunkId}.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);

    try {
      setStatus('sending_chunk');
      const responsePromise = fetch(`${backendUrl}/api/transcribe-chunk`, {
        method: 'POST',
        body: formData,
      });
      window.setTimeout(() => setStatus((current) => (current === 'sending_chunk' ? 'transcribing' : current)), 300);
      window.setTimeout(() => setStatus((current) => (current === 'transcribing' ? 'translating' : current)), 900);
      const data = await readJsonResponse(await responsePromise);
      appendLiveChunk(data);
      const recorder = recorderRef.current;
      if (recorder?.state === 'recording') setStatus('recording');
      if (recorder?.state === 'paused') setStatus('paused');
    } catch (requestError) {
      setError(formatRequestError(requestError, backendUrl));
      setStatus('error');
    }
  }

  function appendLiveChunk(chunk) {
    const transcript = (chunk.transcript || '').trim();
    const translation = (chunk.translation_thai || '').trim();
    if (!transcript && !translation) return;

    const signature = transcript.toLowerCase();
    if (signature && seenChunkTextRef.current.has(signature)) return;
    if (signature) seenChunkTextRef.current.add(signature);

    setLiveResult((current) => ({
      detected_language: chunk.detected_language || current.detected_language,
      transcript: appendText(current.transcript, transcript),
      translation_thai: appendText(current.translation_thai, translation),
      chunks: [...current.chunks, chunk],
      segments: [...current.segments, ...(chunk.segments || [])],
    }));
  }

  function clearLiveTranscript() {
    seenChunkTextRef.current.clear();
    setLiveResult(emptyLiveResult());
    setResult(null);
    setError('');
    setStatus(recorderRef.current?.state === 'recording' ? 'recording' : 'idle');
  }

  function updateApiUrl(value) {
    setApiUrl(value);
    const normalized = value.trim();
    if (normalized) {
      localStorage.setItem('transcribe-api-url', normalized);
    } else {
      localStorage.removeItem('transcribe-api-url');
    }
  }

  async function copyText(key, text) {
    await navigator.clipboard.writeText(text || '');
    setCopied(key);
    window.setTimeout(() => setCopied(''), 1600);
  }

  function downloadResult() {
    const active = getActiveResult(mode, result, liveResult);
    if (!active) return;
    const segmentText = (active.segments || [])
      .map((segment) => `[${formatTime(segment.start)} - ${formatTime(segment.end)}] ${segment.text}`)
      .join('\n');
    const body = [
      `Source type: ${mode === 'live' ? 'live-video' : active.source_type || mode}`,
      videoUrl && mode === 'live' ? `Video URL: ${videoUrl}` : '',
      `Detected language: ${active.detected_language || 'unknown'}`,
      '',
      'Original transcript:',
      active.transcript,
      '',
      'Thai translation:',
      active.translation_thai,
      '',
      'Segments:',
      segmentText || 'No segments returned.',
    ].filter(Boolean).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${mode === 'live' ? 'live-video' : stripExtension(file?.name || 'transcription')}-thai-translation.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const activeResult = getActiveResult(mode, result, liveResult);

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <h1>Transcribe to Thai</h1>
            <p>Local faster-whisper transcription with offline Thai translation.</p>
          </div>
          <div className={`status-pill status-${status}`}>
            {['uploading', 'extracting', 'transcribing', 'translating', 'waiting_permission', 'recording', 'sending_chunk'].includes(status) ? <Loader2 size={16} className="spin" /> : status === 'error' || status === 'permission_denied' || status === 'unsupported' ? <X size={16} /> : <Check size={16} />}
            <span>{statusLabel}</span>
          </div>
        </div>

        <section className="input-panel">
          <label className="backend-field">
            <span>Backend API URL</span>
            <input
              type="url"
              value={apiUrl}
              onChange={(event) => updateApiUrl(event.target.value)}
              placeholder="https://your-fastapi-backend.example.com"
              disabled={isUploading || isRecording}
            />
          </label>

          <div className="segmented" role="tablist" aria-label="Source type">
            <button className={mode === 'upload' ? 'active' : ''} type="button" onClick={() => switchMode('upload')} disabled={controlsDisabled}>
              <FileAudio size={17} />
              <span>Upload file</span>
            </button>
            <button className={mode === 'live' ? 'active' : ''} type="button" onClick={() => switchMode('live')} disabled={controlsDisabled}>
              <MonitorUp size={17} />
              <span>Live video translation</span>
            </button>
          </div>

          {mode === 'upload' ? (
            <div className="source-row">
              <button className="dropzone" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} onChange={handleFileChange} />
                <span className="file-icon"><FileAudio size={28} /></span>
                <span className="file-title">{file ? file.name : 'Choose an audio or video file'}</span>
                <span className="file-meta">
                  {file ? `${formatBytes(file.size)} selected` : 'mp3, wav, m4a, mp4, mov and common media formats'}
                </span>
              </button>

              <div className="actions">
                <button className="primary" type="button" onClick={submitFile} disabled={isUploading}>
                  {isUploading ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
                  <span>{isUploading ? 'Processing' : 'Upload and transcribe'}</span>
                </button>
                <button className="secondary" type="button" onClick={downloadResult} disabled={!activeResult}>
                  <Download size={18} />
                  <span>Download .txt</span>
                </button>
              </div>
            </div>
          ) : (
            <LiveVideoPanel
              videoUrl={videoUrl}
              setVideoUrl={setVideoUrl}
              embedUrl={youtubeEmbedUrl}
              onPlay={() => setAutoplayToken((current) => current + 1)}
              onStartTab={startTabCapture}
              onStartMic={startMicrophoneCapture}
              onPause={pauseLiveTranslation}
              onResume={resumeLiveTranslation}
              onStop={() => stopLiveTranslation()}
              onClear={clearLiveTranscript}
              onDownload={downloadResult}
              isRecording={isRecording}
              isPaused={status === 'paused'}
              hasTranscript={Boolean(liveResult.transcript || liveResult.translation_thai)}
              captureWarning={captureWarning}
            />
          )}
        </section>

        {error && <div className="error-box">{error}</div>}

        <section className="result-grid" aria-label="Transcription result">
          <ResultPane
            title="Original transcript"
            subtitle={activeResult ? `Detected language: ${activeResult.detected_language || 'unknown'}` : 'Waiting for transcription'}
            text={activeResult?.transcript}
            onCopy={() => copyText('transcript', activeResult?.transcript)}
            copied={copied === 'transcript'}
          />
          <ResultPane
            title="Thai translation"
            subtitle={activeResult ? 'Local model output' : 'Translation will appear here'}
            text={activeResult?.translation_thai}
            onCopy={() => copyText('thai', activeResult?.translation_thai)}
            copied={copied === 'thai'}
          />
        </section>

        <section className="segments">
          <div className="section-header">
            <h2>{mode === 'live' ? 'Live chunks' : 'Segments'}</h2>
            <span>{activeResult?.segments?.length || activeResult?.chunks?.length || 0}</span>
          </div>
          {mode === 'live' && liveResult.chunks.length ? (
            <div className="segment-list">
              {liveResult.chunks.map((chunk) => (
                <div className="segment-row" key={chunk.chunk_id}>
                  <time>{chunk.chunk_id}</time>
                  <p>{chunk.transcript || 'No speech detected.'}</p>
                </div>
              ))}
            </div>
          ) : activeResult?.segments?.length ? (
            <div className="segment-list">
              {activeResult.segments.map((segment, index) => (
                <div className="segment-row" key={`${segment.start}-${segment.end}-${index}`}>
                  <time>{formatTime(segment.start)} - {formatTime(segment.end)}</time>
                  <p>{segment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Timestamped segments or live chunks will appear after processing.</div>
          )}
        </section>
      </section>
    </main>
  );
}

function LiveVideoPanel({ videoUrl, setVideoUrl, embedUrl, onPlay, onStartTab, onStartMic, onPause, onResume, onStop, onClear, onDownload, isRecording, isPaused, hasTranscript, captureWarning }) {
  return (
    <div className="live-panel">
      <label className="url-field">
        <span>YouTube URL</span>
        <input
          type="url"
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          disabled={isRecording}
        />
      </label>

      <div className="video-stage">
        {embedUrl ? (
          <iframe
            title="YouTube video player"
            src={embedUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <div className="video-placeholder">Paste a YouTube URL to load the player.</div>
        )}
      </div>

      <div className="capture-note">
        Browsers do not allow this app to directly read audio from a YouTube iframe. Use tab audio capture and select this browser tab with tab audio enabled.
      </div>

      {captureWarning && <div className="warning-box">{captureWarning}</div>}

      <div className="live-actions">
        <button className="secondary" type="button" onClick={onPlay} disabled={!embedUrl}>
          <Play size={18} />
          <span>Play video</span>
        </button>
        <button className="primary" type="button" onClick={isPaused ? onResume : onStartTab} disabled={isRecording && !isPaused}>
          <MonitorUp size={18} />
          <span>{isPaused ? 'Resume translation' : 'Start live translation'}</span>
        </button>
        <button className="secondary" type="button" onClick={onPause} disabled={!isRecording || isPaused}>
          <Pause size={18} />
          <span>Pause live translation</span>
        </button>
        <button className="secondary" type="button" onClick={onStop} disabled={!isRecording && !isPaused}>
          <Square size={18} />
          <span>Stop live translation</span>
        </button>
        <button className="secondary" type="button" onClick={onStartMic} disabled={isRecording}>
          <Mic size={18} />
          <span>Use microphone fallback</span>
        </button>
        <button className="secondary" type="button" onClick={onClear} disabled={!hasTranscript}>
          <Trash2 size={18} />
          <span>Clear transcript</span>
        </button>
        <button className="secondary" type="button" onClick={onDownload} disabled={!hasTranscript}>
          <Download size={18} />
          <span>Download transcript</span>
        </button>
      </div>
    </div>
  );
}

function ResultPane({ title, subtitle, text, onCopy, copied }) {
  return (
    <article className="result-pane">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button className="icon-button" type="button" onClick={onCopy} disabled={!text} title={`Copy ${title}`}>
          {copied ? <Check size={18} /> : <Clipboard size={18} />}
        </button>
      </div>
      <div className="text-output">{text || 'No content yet.'}</div>
    </article>
  );
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed with status ${response.status}`);
  }
  return data;
}

function emptyLiveResult() {
  return {
    detected_language: '',
    transcript: '',
    translation_thai: '',
    segments: [],
    chunks: [],
  };
}

function appendText(current, next) {
  if (!next) return current;
  if (!current) return next;
  if (current.toLowerCase().includes(next.toLowerCase())) return current;
  return `${current}\n\n${next}`;
}

function getActiveResult(mode, fileResult, liveResult) {
  if (mode === 'live') {
    return liveResult.transcript || liveResult.translation_thai || liveResult.chunks.length ? liveResult : null;
  }
  return fileResult;
}

function chooseRecorderMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'video/webm;codecs=opus', 'video/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function getYouTubeEmbedUrl(url, autoplayToken) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return '';
  const autoplay = autoplayToken > 0 ? '&autoplay=1' : '';
  return `https://www.youtube.com/embed/${videoId}?enablejsapi=1${autoplay}`;
}

function getYouTubeVideoId(url) {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0];
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] || '';
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || '';
    }
  } catch {
    return '';
  }
  return '';
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;
  return `${minutes}:${remaining.toFixed(1).padStart(4, '0')}`;
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, '');
}

function getBackendUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

function formatRequestError(error, backendUrl) {
  if (error?.message === 'Failed to fetch') {
    return `Cannot reach the backend at ${backendUrl}. Check that FastAPI is deployed, reachable over HTTPS, and allows this frontend origin.`;
  }
  return error?.message || 'Processing failed.';
}

createRoot(document.getElementById('root')).render(<App />);
