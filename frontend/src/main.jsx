import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Clipboard, Download, FileAudio, Link, Loader2, Upload, X } from 'lucide-react';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const ACCEPTED_TYPES = '.mp3,.wav,.m4a,.mp4,.mov,.aac,.flac,.ogg,.webm,audio/*,video/*';
const URL_PROGRESS_STAGES = ['validating', 'downloading', 'extracting', 'transcribing', 'translating'];

function App() {
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState('upload');
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState('');

  const statusLabel = useMemo(() => {
    const labels = {
      idle: 'Ready',
      uploading: 'Uploading file',
      validating: 'Validating URL',
      downloading: 'Downloading audio',
      extracting: 'Extracting audio',
      transcribing: 'Transcribing',
      translating: 'Translating',
      complete: 'Complete',
      error: 'Needs attention',
    };
    return labels[status] || 'Processing';
  }, [status]);

  const isBusy = ['uploading', 'validating', 'downloading', 'extracting', 'transcribing', 'translating'].includes(status);

  function switchMode(nextMode) {
    if (isBusy) return;
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
      const responsePromise = fetch(`${API_URL}/api/transcribe`, {
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
      setError(formatRequestError(requestError));
      setStatus('error');
    }
  }

  async function submitUrl() {
    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl) {
      setError('Paste a YouTube URL first.');
      setStatus('error');
      return;
    }

    setError('');
    setResult(null);
    setStatus('validating');

    let stageTimer = null;
    try {
      const responsePromise = fetch(`${API_URL}/api/transcribe-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmedUrl }),
      });

      let stageIndex = 0;
      stageTimer = window.setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, URL_PROGRESS_STAGES.length - 1);
        setStatus(URL_PROGRESS_STAGES[stageIndex]);
      }, 1400);

      const data = await readJsonResponse(await responsePromise);
      setResult(data);
      setStatus('complete');
    } catch (requestError) {
      setError(formatRequestError(requestError));
      setStatus('error');
    } finally {
      if (stageTimer) window.clearInterval(stageTimer);
    }
  }

  async function copyText(key, text) {
    await navigator.clipboard.writeText(text || '');
    setCopied(key);
    window.setTimeout(() => setCopied(''), 1600);
  }

  function downloadResult() {
    if (!result) return;
    const segmentText = result.segments
      .map((segment) => `[${formatTime(segment.start)} - ${formatTime(segment.end)}] ${segment.text}`)
      .join('\n');
    const body = [
      `Source type: ${result.source_type || mode}`,
      result.source_url ? `Source URL: ${result.source_url}` : '',
      result.video_title ? `Video title: ${result.video_title}` : '',
      `Detected language: ${result.detected_language}`,
      '',
      'Original transcript:',
      result.transcript,
      '',
      'Thai translation:',
      result.translation_thai,
      '',
      'Segments:',
      segmentText || 'No segments returned.',
    ].filter(Boolean).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${downloadBaseName(result, file)}-thai-translation.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="topbar">
          <div>
            <h1>Transcribe to Thai</h1>
            <p>Local faster-whisper transcription with offline Thai translation.</p>
          </div>
          <div className={`status-pill status-${status}`}>
            {isBusy ? <Loader2 size={16} className="spin" /> : status === 'error' ? <X size={16} /> : <Check size={16} />}
            <span>{statusLabel}</span>
          </div>
        </div>

        <section className="input-panel">
          <div className="segmented" role="tablist" aria-label="Source type">
            <button className={mode === 'upload' ? 'active' : ''} type="button" onClick={() => switchMode('upload')} disabled={isBusy}>
              <FileAudio size={17} />
              <span>Upload file</span>
            </button>
            <button className={mode === 'url' ? 'active' : ''} type="button" onClick={() => switchMode('url')} disabled={isBusy}>
              <Link size={17} />
              <span>Paste video URL</span>
            </button>
          </div>

          {mode === 'upload' ? (
            <div className="source-row">
              <button className="dropzone" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
                <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES} onChange={handleFileChange} />
                <span className="file-icon"><FileAudio size={28} /></span>
                <span className="file-title">{file ? file.name : 'Choose an audio or video file'}</span>
                <span className="file-meta">
                  {file ? `${formatBytes(file.size)} selected` : 'mp3, wav, m4a, mp4, mov and common media formats'}
                </span>
              </button>

              <div className="actions">
                <button className="primary" type="button" onClick={submitFile} disabled={isBusy}>
                  {isBusy ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
                  <span>{isBusy ? 'Processing' : 'Upload and transcribe'}</span>
                </button>
                <button className="secondary" type="button" onClick={downloadResult} disabled={!result}>
                  <Download size={18} />
                  <span>Download .txt</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="source-row">
              <label className="url-field">
                <span>Video URL</span>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={isBusy}
                />
              </label>

              <div className="actions">
                <button className="primary" type="button" onClick={submitUrl} disabled={isBusy}>
                  {isBusy ? <Loader2 size={18} className="spin" /> : <Link size={18} />}
                  <span>{isBusy ? 'Processing' : 'Transcribe URL'}</span>
                </button>
                <button className="secondary" type="button" onClick={downloadResult} disabled={!result}>
                  <Download size={18} />
                  <span>Download .txt</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {error && <div className="error-box">{error}</div>}

        {result?.video_title && (
          <div className="source-summary">
            <strong>{result.video_title}</strong>
            {result.source_url && <span>{result.source_url}</span>}
          </div>
        )}

        <section className="result-grid" aria-label="Transcription result">
          <ResultPane
            title="Original transcript"
            subtitle={result ? `Detected language: ${result.detected_language}` : 'Waiting for a completed transcription'}
            text={result?.transcript}
            onCopy={() => copyText('transcript', result?.transcript)}
            copied={copied === 'transcript'}
          />
          <ResultPane
            title="Thai translation"
            subtitle={result ? 'Local model output' : 'Translation will appear here'}
            text={result?.translation_thai}
            onCopy={() => copyText('thai', result?.translation_thai)}
            copied={copied === 'thai'}
          />
        </section>

        <section className="segments">
          <div className="section-header">
            <h2>Segments</h2>
            <span>{result?.segments?.length || 0}</span>
          </div>
          {result?.segments?.length ? (
            <div className="segment-list">
              {result.segments.map((segment, index) => (
                <div className="segment-row" key={`${segment.start}-${segment.end}-${index}`}>
                  <time>{formatTime(segment.start)} - {formatTime(segment.end)}</time>
                  <p>{segment.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Timestamped segments will appear after processing.</div>
          )}
        </section>
      </section>
    </main>
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

function downloadBaseName(result, file) {
  if (result?.video_title) return result.video_title.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '') || 'video';
  return stripExtension(file?.name || 'transcription');
}

function formatRequestError(error) {
  if (error?.message === 'Failed to fetch') {
    return `Cannot reach the backend at ${API_URL}. Start FastAPI on port 8000, then try again.`;
  }
  return error?.message || 'Processing failed.';
}

createRoot(document.getElementById('root')).render(<App />);
