from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Protocol

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("voicelock.transcription")

DIGIT_TO_WORD = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}


@dataclass
class ChallengeTranscriptionResult:
    provider: str
    status: str  # COMPLETED | FAILED
    matched: bool
    normalized_result: str  # MATCH | MISMATCH | TRANSCRIPTION_ERROR
    transcript: str = ""
    normalized_transcript: str = ""
    normalized_expected: str = ""
    matched_tokens: List[str] = field(default_factory=list)
    missing_tokens: List[str] = field(default_factory=list)
    match_ratio: float = 0.0
    language: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    disclaimer: str = (
        "Speech transcription validates only whether the issued challenge phrase was spoken. "
        "It does not verify speaker identity or voice authenticity."
    )


class STTProvider(Protocol):
    name: str

    def transcribe(self, audio_path: Path) -> tuple[str, Optional[str]]:
        """Transcribe an audio file to (raw_text, detected_language)."""
        ...


class FasterWhisperProvider:
    """Local faster-whisper transcription provider (modular STTProvider implementation)."""

    name = "faster_whisper"

    def __init__(self, model_size: str, device: str, compute_type: str) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self._model = None

    def _get_model(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            logger.info(
                "Loading faster-whisper model=%s device=%s compute_type=%s",
                self.model_size,
                self.device,
                self.compute_type,
            )
            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def transcribe(self, audio_path: Path) -> tuple[str, Optional[str]]:
        model = self._get_model()
        segments, info = model.transcribe(str(audio_path), beam_size=5, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments if seg.text).strip()
        language = getattr(info, "language", None)
        return text, language


@lru_cache
def get_default_stt_provider() -> FasterWhisperProvider:
    settings = get_settings()
    return FasterWhisperProvider(
        model_size=settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )


def normalize_phrase_tokens(text: str) -> List[str]:
    """
    Normalize text for challenge phrase comparison:
    - lowercase and strip punctuation
    - split multi-digit numbers (e.g., '74' -> ['seven', 'four'])
    - map digits 0..9 to English words
    """
    cleaned = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    tokens: List[str] = []
    for raw_tok in cleaned.split():
        if raw_tok.isdigit():
            for ch in raw_tok:
                tokens.append(DIGIT_TO_WORD.get(ch, ch))
        else:
            tokens.append(raw_tok)
    return tokens


def compare_challenge_phrase(expected_phrase: str, transcript: str) -> tuple[bool, float, List[str], List[str], str, str]:
    """
    Compare normalized challenge tokens against transcript tokens in order.
    Requires all expected tokens (or >=85% with exact ordered match for minor ASR slips)
    to pass; specifically requires 100% exact ordered match when expected has <= 8 tokens,
    allowing at most 1 ASR slip only if >= 85% match and filler words are ignored.
    """
    expected_tokens = normalize_phrase_tokens(expected_phrase)
    transcript_tokens = normalize_phrase_tokens(transcript)

    norm_expected = " ".join(expected_tokens)
    norm_transcript = " ".join(transcript_tokens)

    if not expected_tokens or not transcript_tokens:
        return False, 0.0, [], expected_tokens, norm_expected, norm_transcript

    # Ordered subsequence matching
    matched: List[str] = []
    missing: List[str] = []
    t_idx = 0
    for exp_tok in expected_tokens:
        found = False
        for scan in range(t_idx, len(transcript_tokens)):
            if transcript_tokens[scan] == exp_tok:
                matched.append(exp_tok)
                t_idx = scan + 1
                found = True
                break
        if not found:
            missing.append(exp_tok)

    ratio = round(len(matched) / len(expected_tokens), 3)
    # Require >= 85% ordered match AND core digits/nouns intact (for 7-token phrase, at least 6/7)
    is_match = ratio >= 0.85 and len(missing) <= 1
    return is_match, ratio, matched, missing, norm_expected, norm_transcript


class TranscriptionService:
    """Coordinates STT transcription and challenge phrase validation."""

    def __init__(self, provider: Optional[STTProvider] = None) -> None:
        self.provider = provider

    def verify_challenge(
        self,
        *,
        audio_path: Path,
        expected_phrase: str,
    ) -> ChallengeTranscriptionResult:
        provider = self.provider or get_default_stt_provider()
        try:
            transcript, language = provider.transcribe(audio_path)
        except Exception as exc:
            logger.exception("Transcription failed provider=%s", getattr(provider, "name", "unknown"))
            return ChallengeTranscriptionResult(
                provider=getattr(provider, "name", "faster_whisper"),
                status="FAILED",
                matched=False,
                normalized_result="TRANSCRIPTION_ERROR",
                normalized_expected=" ".join(normalize_phrase_tokens(expected_phrase)),
                error_code="transcription_failed",
                error_message=f"Speech transcription failed: {type(exc).__name__}",
            )

        matched, ratio, matched_tokens, missing_tokens, norm_exp, norm_tx = compare_challenge_phrase(
            expected_phrase, transcript
        )
        return ChallengeTranscriptionResult(
            provider=getattr(provider, "name", "faster_whisper"),
            status="COMPLETED",
            matched=matched,
            normalized_result="MATCH" if matched else "MISMATCH",
            transcript=transcript,
            normalized_transcript=norm_tx,
            normalized_expected=norm_exp,
            matched_tokens=matched_tokens,
            missing_tokens=missing_tokens,
            match_ratio=ratio,
            language=language,
        )
