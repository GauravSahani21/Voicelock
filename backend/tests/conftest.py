from __future__ import annotations

import io
import math
import os
import struct
import wave
from collections.abc import Generator

# Point tests at isolated PostgreSQL test database BEFORE importing app modules
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://voicelock:voicelock@localhost:5432/voicelock_test")
os.environ.setdefault("DETECTIF_PROVIDER_MODE", "mock")
os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-voicelock-pytest-suite")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database.base import Base
from app.database.seed import seed_demo_data
from app.database.session import get_db
from app.main import app
from app.middleware.rate_limit import reset_all_rate_limiters

TEST_DB_URL = os.environ["DATABASE_URL"]
test_engine = create_engine(TEST_DB_URL, pool_pre_ping=True, future=True)
TestSessionLocal = sessionmaker(
    bind=test_engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)


def make_wav_bytes(duration_seconds: float, sample_rate: int = 16000, freq_hz: float = 440.0) -> bytes:
    """Generate a valid mono 16-bit PCM WAV byte buffer of exact duration."""
    num_samples = int(duration_seconds * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(num_samples):
            val = int(12000 * math.sin(2.0 * math.pi * freq_hz * (i / sample_rate)))
            frames.extend(struct.pack("<h", val))
        wf.writeframes(bytes(frames))
    return buf.getvalue()


@pytest.fixture(scope="session", autouse=True)
def setup_test_database() -> Generator[None, None, None]:
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    with TestSessionLocal() as db:
        seed_demo_data(db)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(autouse=True)
def reset_limiters() -> None:
    reset_all_rate_limiters()


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    with TestSessionLocal() as session:
        yield session


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        with TestSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
