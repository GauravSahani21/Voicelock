from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_endpoint_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["app_name"] == "VoiceLock Gateway"
    assert payload["status"] in ("ok", "degraded")
    assert payload["database"] in ("connected", "unavailable")
    assert payload["detectif_provider_mode"] in ("live", "mock")
    assert "X-Request-Id" in response.headers
