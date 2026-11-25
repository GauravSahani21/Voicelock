from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    audit,
    auth,
    dashboard,
    decisions,
    demo,
    enrollments,
    health,
    policies,
    provider_status,
    sessions,
    simulator,
    tenants,
    tokens,
    workflows,
)
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger

settings = get_settings()
configure_logging()
logger = get_logger("voicelock.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.resolved_temp_audio_dir
    logger.info(
        "VoiceLock Gateway started env=%s provider_mode=%s",
        settings.app_env,
        settings.active_provider_mode,
    )
    yield
    logger.info("VoiceLock Gateway shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="VoiceLock Gateway API",
        description=(
            "Universal Voice Security & Action Authorization Layer. "
            "Combines Detectif.ai Aletheia, Detectif.ai Eidos, fresh spoken challenges, "
            "deterministic industry policies, and single-use action-bound authorization tokens."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or f"vl_req_{uuid.uuid4().hex[:16]}"
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response

    register_exception_handlers(app)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(tenants.router)
    app.include_router(enrollments.router)
    app.include_router(sessions.router)
    app.include_router(decisions.router)
    app.include_router(tokens.router)
    app.include_router(policies.router)
    app.include_router(audit.router)
    app.include_router(provider_status.router)
    app.include_router(dashboard.router)
    app.include_router(workflows.router)
    app.include_router(simulator.router)
    app.include_router(demo.router)

    return app


app = create_app()
