from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app


def test_demo_overview_bootstrap_and_reset(client: TestClient) -> None:
    overview = client.get("/api/demo/overview-state")
    assert overview.status_code == 200
    data = overview.json()
    assert data["demo_enabled"] is True
    assert len(data["portals"]) == 4

    boot = client.post("/api/demo/bootstrap", json={"role_mode": "admin"})
    assert boot.status_code == 200
    token = boot.json()["access_token"]

    # Telecom scoped bootstrap works and stays tenant-isolated
    tel_boot = client.post("/api/demo/bootstrap", json={"role_mode": "telecom"})
    assert tel_boot.status_code == 200
    tel_token = tel_boot.json()["access_token"]
    tenants = client.get("/api/tenants", headers={"Authorization": f"Bearer {tel_token}"}).json()
    assert len(tenants) == 1
    assert tenants[0]["slug"] == "demo-telecom"

    # Reset clears transient sessions cleanly while preserving baseline tenants
    reset_resp = client.post(
        "/api/demo/reset",
        headers={"Authorization": f"Bearer {token}"},
        json={"clear_enrollments": False},
    )
    assert reset_resp.status_code == 200
    assert reset_resp.json()["status"] == "reset_complete"


def test_demo_blocked_in_production_mode(client: TestClient) -> None:
    prod_settings = Settings(app_env="production", detectif_provider_mode="mock")
    app.dependency_overrides[get_settings] = lambda: prod_settings
    try:
        res = client.post("/api/demo/bootstrap", json={"role_mode": "admin"})
        assert res.status_code == 403
        assert res.json()["error"]["code"] == "demo_disabled_in_production"
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_dashboard_live_metrics_and_session_cancel_reconciliation(client: TestClient) -> None:
    boot = client.post("/api/demo/bootstrap", json={"role_mode": "admin"})
    assert boot.status_code == 200
    headers = {"Authorization": f"Bearer {boot.json()['access_token']}"}

    # Start from a clean reset state
    assert client.post("/api/demo/reset", headers=headers, json={"clear_enrollments": False}).status_code == 200
    ov0 = client.get("/api/dashboard/overview", headers=headers).json()
    assert ov0["total_requests"] == 0
    assert ov0["evaluated_requests"] == 0
    assert ov0["pending_requests"] == 0
    assert ov0["expired_or_cancelled_requests"] == 0

    tenants = client.get("/api/tenants", headers=headers).json()
    uni = next(t for t in tenants if t["industry"] == "education")
    users = client.get(f"/api/tenants/{uni['id']}/users", headers=headers).json()

    # Create a session then cancel it (mirrors user backing out of verification)
    s_cancel = client.post(
        "/api/sessions",
        headers=headers,
        json={
            "tenant_id": uni["id"],
            "user_id": users[0]["id"],
            "requested_action": "view_academic_records",
            "resource_reference": "UNI-CANCEL-1",
        },
    ).json()
    c_res = client.post(f"/api/sessions/{s_cancel['id']}/cancel", headers=headers)
    assert c_res.status_code == 200
    assert c_res.json()["status"] == "CANCELLED"

    # Create a second active pending session
    client.post(
        "/api/sessions",
        headers=headers,
        json={
            "tenant_id": uni["id"],
            "user_id": users[0]["id"],
            "requested_action": "view_academic_records",
            "resource_reference": "UNI-PENDING-2",
        },
    )

    # Run a deterministic simulator scenario (wrong phrase -> REJECT even on view_academic_records)
    sim = client.post(
        "/api/simulator/run",
        headers=headers,
        json={
            "scenario_id": "wrong_challenge_phrase",
            "tenant_id": uni["id"],
            "user_id": users[0]["id"],
            "action": "view_academic_records",
        },
    )
    assert sim.status_code == 200
    assert sim.json()["actual_outcome"] == "REJECT"

    ov1 = client.get("/api/dashboard/overview", headers=headers).json()
    assert ov1["total_requests"] == 3
    assert ov1["evaluated_requests"] == 1
    assert ov1["pending_requests"] == 1
    assert ov1["expired_or_cancelled_requests"] == 1
    assert ov1["live_workflow_requests"] == 2
    assert ov1["simulated_scenario_requests"] == 1
    assert ov1["rejected_requests"] == 1
    assert ov1["industry_activity"]["education"] == 3
    assert (
        ov1["evaluated_requests"] + ov1["pending_requests"] + ov1["expired_or_cancelled_requests"]
        == ov1["total_requests"]
    )


def test_register_new_end_user_with_auto_reference_and_defaults(client: TestClient) -> None:
    boot = client.post("/api/demo/bootstrap", json={"role_mode": "admin"})
    assert boot.status_code == 200
    headers = {"Authorization": f"Bearer {boot.json()['access_token']}"}

    tenants = client.get("/api/tenants", headers=headers).json()
    tel = next(t for t in tenants if t["industry"] == "telecom")
    edu = next(t for t in tenants if t["industry"] == "education")

    # Omit external_reference and metadata_json -> backend auto-generates unique ref & defaults
    created_tel = client.post(
        f"/api/tenants/{tel['id']}/users",
        headers=headers,
        json={
            "name": "Maya Patel",
            "email": "maya@example.com",
            "phone_reference": "+1-555-7788",
            "role": "customer",
        },
    )
    assert created_tel.status_code == 201, created_tel.text
    tel_user = created_tel.json()
    assert tel_user["external_reference"].startswith("CUST-TEL-")
    assert tel_user["metadata_json"]["masked_phone"] == "+1 (555) •••-7788"
    assert tel_user["metadata_json"]["sim_status"] == "Active"
    assert tel_user["enrollment_status"] == "not_enrolled"

    # Education faculty registration preserves custom metadata & generates FAC-UNI- prefix
    created_fac = client.post(
        f"/api/tenants/{edu['id']}/users",
        headers=headers,
        json={
            "name": "Dr. Vikram Mehta",
            "role": "faculty",
            "metadata_json": {"department": "Robotics"},
        },
    )
    assert created_fac.status_code == 201, created_fac.text
    fac_user = created_fac.json()
    assert fac_user["external_reference"].startswith("FAC-UNI-")
    assert fac_user["metadata_json"]["department"] == "Robotics"
    assert fac_user["metadata_json"]["title"] == "Faculty Member"
