from __future__ import annotations

import logging
import re

SECRET_PATTERNS = [
    re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]+", re.IGNORECASE),
    re.compile(r"(dtf_[A-Za-z0-9_\-]+)", re.IGNORECASE),
    re.compile(r"(vl_tok_[A-Za-z0-9_\-]+)", re.IGNORECASE),
]


class SecretRedactingFilter(logging.Filter):
    """Redact API keys, bearer tokens, and decision tokens from log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        redacted = msg
        for pattern in SECRET_PATTERNS:
            if pattern.groups:
                redacted = pattern.sub(r"\1[REDACTED]", redacted)
            else:
                redacted = pattern.sub("[REDACTED]", redacted)
        if redacted != msg:
            record.msg = redacted
            record.args = ()
        return True


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")
        )
        handler.addFilter(SecretRedactingFilter())
        root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not any(isinstance(f, SecretRedactingFilter) for f in logger.filters):
        logger.addFilter(SecretRedactingFilter())
    return logger
