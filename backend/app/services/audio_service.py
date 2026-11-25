from __future__ import annotations

import contextlib
import uuid
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

import av
from fastapi import UploadFile, status

from app.core.config import get_settings
from app.core.errors import VoiceLockError

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".webm", ".aiff", ".aif"}
ALLOWED_MIME_PREFIXES = (
    "audio/",
    "video/webm",  # Chrome MediaRecorder often labels audio-only WebM blobs as video/webm or audio/webm
    "application/ogg",
    "application/octet-stream",  # Allow fallback when extension & header validation confirm valid audio
)


@dataclass(frozen=True)
class AudioMetadata:
    filename: str
    content_type: str
    size_bytes: int
    duration_seconds: float
    sample_rate: Optional[int]
    channels: Optional[int]
    codec: Optional[str]


def _inspect_audio_file(path: Path) -> tuple[float, Optional[int], Optional[int], Optional[str]]:
    """Decode container/stream metadata via PyAV (or stdlib wave fallback) to verify genuine audio."""
    try:
        with av.open(str(path)) as container:
            audio_streams = [s for s in container.streams if s.type == "audio"]
            if not audio_streams:
                raise VoiceLockError(
                    code="corrupt_or_no_audio_stream",
                    message="Uploaded file does not contain a valid audio stream.",
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                )
            stream = audio_streams[0]
            duration = 0.0
            if container.duration is not None and container.duration > 0:
                duration = float(container.duration) / float(av.time_base)
            elif stream.duration is not None and stream.time_base is not None:
                duration = float(stream.duration * stream.time_base)

            # Some WebM/Opus streams from MediaRecorder lack container duration in header; decode frames to measure.
            if duration <= 0.0:
                total_samples = 0
                sr = stream.sample_rate or 48000
                for frame in container.decode(audio=0):
                    total_samples += frame.samples
                if total_samples > 0 and sr > 0:
                    duration = total_samples / float(sr)

            return (
                round(duration, 3),
                stream.sample_rate,
                stream.channels,
                stream.codec_context.name if stream.codec_context else None,
            )
    except VoiceLockError:
        raise
    except Exception as exc:
        # Fallback for simple PCM WAV if PyAV fails on unusual header
        if path.suffix.lower() == ".wav":
            try:
                with wave.open(str(path), "rb") as wf:
                    frames = wf.getnframes()
                    rate = wf.getframerate()
                    channels = wf.getnchannels()
                    duration = frames / float(rate) if rate > 0 else 0.0
                    return round(duration, 3), rate, channels, "pcm"
            except Exception:
                pass
        raise VoiceLockError(
            code="corrupt_audio",
            message="Unable to decode audio file. Please submit a valid WAV, WebM, MP3, OGG, FLAC, or M4A recording.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            details={"reason": type(exc).__name__},
        ) from exc


@contextlib.contextmanager
def temporary_audio_upload(
    upload: UploadFile,
    *,
    min_duration_seconds: float,
    max_duration_seconds: float,
) -> Iterator[tuple[Path, AudioMetadata]]:
    """
    Validate an uploaded audio file, persist it strictly to temporary processing storage,
    yield (temp_path, metadata), and always delete the temporary file afterwards.
    """
    settings = get_settings()
    filename = upload.filename or "recording.webm"
    ext = Path(filename).suffix.lower()
    content_type = (upload.content_type or "application/octet-stream").split(";")[0].strip().lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise VoiceLockError(
            code="unsupported_audio_format",
            message=f"Unsupported audio extension '{ext or 'none'}'. Supported: WAV, MP3, M4A, FLAC, OGG, WebM, AIFF.",
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )

    if not any(content_type.startswith(prefix) for prefix in ALLOWED_MIME_PREFIXES):
        raise VoiceLockError(
            code="unsupported_mime_type",
            message=f"Unsupported MIME type '{content_type}'.",
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )

    raw_bytes = upload.file.read(settings.max_audio_bytes + 1)
    if not raw_bytes:
        raise VoiceLockError(
            code="empty_audio_file",
            message="Uploaded audio file is empty.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    if len(raw_bytes) > settings.max_audio_bytes:
        raise VoiceLockError(
            code="audio_too_large",
            message=f"Audio upload exceeds maximum allowed size of {settings.max_audio_size_mb} MB.",
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        )

    temp_dir = settings.resolved_temp_audio_dir
    temp_path = temp_dir / f"{uuid.uuid4().hex}{ext}"

    try:
        temp_path.write_bytes(raw_bytes)
        duration_seconds, sample_rate, channels, codec = _inspect_audio_file(temp_path)

        if duration_seconds <= 0.0:
            raise VoiceLockError(
                code="silent_or_empty_audio",
                message="Audio recording has zero measurable duration.",
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            )

        if duration_seconds < min_duration_seconds:
            raise VoiceLockError(
                code="audio_too_short",
                message=(
                    f"Recording duration ({duration_seconds:.1f}s) is shorter than the required "
                    f"minimum of {min_duration_seconds:.0f}s."
                ),
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                details={
                    "duration_seconds": duration_seconds,
                    "min_duration_seconds": min_duration_seconds,
                },
            )

        if duration_seconds > max_duration_seconds:
            raise VoiceLockError(
                code="audio_too_long",
                message=(
                    f"Recording duration ({duration_seconds:.1f}s) exceeds the maximum allowed "
                    f"limit of {max_duration_seconds:.0f}s."
                ),
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                details={
                    "duration_seconds": duration_seconds,
                    "max_duration_seconds": max_duration_seconds,
                },
            )

        meta = AudioMetadata(
            filename=filename,
            content_type=content_type,
            size_bytes=len(raw_bytes),
            duration_seconds=duration_seconds,
            sample_rate=sample_rate,
            channels=channels,
            codec=codec,
        )
        yield temp_path, meta
    finally:
        temp_path.unlink(missing_ok=True)
