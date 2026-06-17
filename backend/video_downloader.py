import ipaddress
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


class VideoDownloadError(ValueError):
    pass


class UnsupportedUrlError(VideoDownloadError):
    pass


class VideoTooLongError(VideoDownloadError):
    pass


class VideoTooLargeError(VideoDownloadError):
    pass


class VideoUnavailableError(VideoDownloadError):
    pass


@dataclass
class DownloadedVideo:
    audio_path: Path
    title: str
    source_url: str


ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}


def download_audio_from_url(url: str, temp_dir: Path) -> DownloadedVideo:
    validate_video_url(url)
    ensure_yt_dlp()
    ensure_ffmpeg()

    timeout = int(os.getenv("YTDLP_TIMEOUT_SECONDS", "600"))
    metadata = get_video_metadata(url, timeout=timeout)
    validate_metadata(metadata)

    output_template = str(temp_dir / "%(title).80s-%(id)s.%(ext)s")
    command = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--restrict-filenames",
        "--no-part",
        "--newline",
        "--socket-timeout",
        os.getenv("YTDLP_SOCKET_TIMEOUT_SECONDS", "20"),
        "--max-filesize",
        os.getenv("VIDEO_MAX_FILE_SIZE", "500M"),
        "--paths",
        str(temp_dir),
        "--output",
        output_template,
        "--print",
        "after_move:filepath",
        url,
    ]

    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise VideoDownloadError("yt-dlp download timed out.") from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or "yt-dlp download failed.").strip()
        raise VideoUnavailableError(classify_yt_dlp_error(message)) from exc

    audio_path = find_downloaded_audio(completed.stdout, temp_dir)
    return DownloadedVideo(
        audio_path=audio_path,
        title=str(metadata.get("title") or "Untitled video"),
        source_url=url,
    )


def validate_video_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise UnsupportedUrlError("Invalid URL. Use a secure https YouTube URL.")
    if parsed.username or parsed.password:
        raise UnsupportedUrlError("Invalid URL. Credentials in URLs are not allowed.")

    host = (parsed.hostname or "").lower()
    if not host:
        raise UnsupportedUrlError("Invalid URL. Missing hostname.")

    try:
        ipaddress.ip_address(host)
        raise UnsupportedUrlError("Invalid URL. Direct IP addresses are not allowed.")
    except ValueError:
        pass

    if host not in ALLOWED_HOSTS:
        raise UnsupportedUrlError("Unsupported website. YouTube URLs are supported first.")


def get_video_metadata(url: str, timeout: int) -> dict:
    command = [
        "yt-dlp",
        "--dump-single-json",
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        "--socket-timeout",
        os.getenv("YTDLP_SOCKET_TIMEOUT_SECONDS", "20"),
        url,
    ]

    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise VideoDownloadError("yt-dlp metadata lookup timed out.") from exc
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or "yt-dlp could not read this URL.").strip()
        raise VideoUnavailableError(classify_yt_dlp_error(message)) from exc

    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise VideoDownloadError("yt-dlp returned invalid metadata.") from exc


def validate_metadata(metadata: dict) -> None:
    if metadata.get("is_live") or metadata.get("live_status") in {"is_live", "is_upcoming"}:
        raise VideoDownloadError("Livestreams and upcoming videos are not supported.")

    duration = metadata.get("duration")
    max_duration = int(os.getenv("VIDEO_MAX_DURATION_SECONDS", "1800"))
    if duration and float(duration) > max_duration:
        raise VideoTooLongError(f"Video too long. Maximum duration is {max_duration} seconds.")

    max_bytes = parse_size_to_bytes(os.getenv("VIDEO_MAX_FILE_SIZE", "500M"))
    estimated_size = metadata.get("filesize") or metadata.get("filesize_approx")
    if estimated_size and int(estimated_size) > max_bytes:
        raise VideoTooLargeError(f"Video too large. Maximum download size is {os.getenv('VIDEO_MAX_FILE_SIZE', '500M')}.")


def find_downloaded_audio(stdout: str, temp_dir: Path) -> Path:
    candidates = [Path(line.strip()) for line in stdout.splitlines() if line.strip()]
    candidates.extend(temp_dir.glob("*.wav"))
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise VideoDownloadError("yt-dlp completed but no downloaded audio file was found.")


def ensure_yt_dlp() -> None:
    if shutil.which("yt-dlp") is None:
        raise FileNotFoundError("yt-dlp is not installed or not available on PATH.")


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise FileNotFoundError("FFmpeg is not installed or not available on PATH.")


def classify_yt_dlp_error(message: str) -> str:
    lowered = message.lower()
    if "ffmpeg" in lowered:
        return "FFmpeg is not installed or yt-dlp cannot find it on PATH."
    if "private" in lowered:
        return "Private video. This URL is not available to yt-dlp."
    if "unavailable" in lowered or "not available" in lowered:
        return "Video unavailable. It may be removed, blocked, or region-restricted."
    if "age" in lowered:
        return "Age-restricted video. yt-dlp cannot access it without additional authentication."
    if "file is larger than max-filesize" in lowered:
        return f"Video too large. Maximum download size is {os.getenv('VIDEO_MAX_FILE_SIZE', '500M')}."
    return f"yt-dlp download failure: {message}"


def parse_size_to_bytes(value: str) -> int:
    normalized = value.strip().upper()
    multiplier = 1
    if normalized.endswith("K"):
        multiplier = 1024
        normalized = normalized[:-1]
    elif normalized.endswith("M"):
        multiplier = 1024**2
        normalized = normalized[:-1]
    elif normalized.endswith("G"):
        multiplier = 1024**3
        normalized = normalized[:-1]
    return int(float(normalized) * multiplier)
