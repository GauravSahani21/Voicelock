from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Callable

from fastapi import Request, status

from app.core.errors import VoiceLockError


class SlidingWindowRateLimiter:
    """Thread-safe in-process sliding-window rate limiter for sensitive endpoints."""

    def __init__(self, max_requests: int, window_seconds: int = 60) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_requests:
                raise VoiceLockError(
                    code="rate_limit_exceeded",
                    message="Too many requests to this sensitive endpoint. Please wait and retry.",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    details={"retry_after_seconds": self.window_seconds},
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


_limiters: dict[str, SlidingWindowRateLimiter] = {}


def rate_limit(bucket: str, max_requests: int = 60, window_seconds: int = 60) -> Callable[[Request], None]:
    if bucket not in _limiters:
        _limiters[bucket] = SlidingWindowRateLimiter(max_requests=max_requests, window_seconds=window_seconds)
    limiter = _limiters[bucket]

    def dependency(request: Request) -> None:
        client_host = request.client.host if request.client else "unknown"
        limiter.check(f"{bucket}:{client_host}")

    return dependency


def reset_all_rate_limiters() -> None:
    for limiter in _limiters.values():
        limiter.reset()
