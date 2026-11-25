from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.models.entities import EndUser, OperatorAccount, Tenant
from app.schemas.gateway import AuditEventOut, VerificationResultOut
from app.services.simulator_service import SCENARIOS, run_simulated_scenario

router = APIRouter(prefix="/api/simulator", tags=["Attack Simulator"])


class SimulatorScenarioOut(BaseModel):
    scenario_id: str
    title: str
    category: str
    description: str
    default_industry: str
    default_action: str
    expected_outcome: str
    expected_security_behavior: str


class SimulatorRunRequest(BaseModel):
    scenario_id: str
    tenant_id: str
    user_id: str
    action: Optional[str] = None


class SimulatorRunResponse(BaseModel):
    label: str
    scenario: SimulatorScenarioOut
    session_id: str
    requested_action: str
    industry: str
    policy_id: str
    policy_version: str
    expected_outcome: str
    actual_outcome: str
    reason_codes: List[str]
    triggered_rules: List[str]
    explanation: str
    token_replay_blocked: bool
    results: List[VerificationResultOut]
    audit_events: List[AuditEventOut]


@router.get("/scenarios", response_model=List[SimulatorScenarioOut])
def list_scenarios(
    operator: OperatorAccount = Depends(get_current_operator),
) -> List[SimulatorScenarioOut]:
    return [
        SimulatorScenarioOut(
            scenario_id=s.scenario_id,
            title=s.title,
            category=s.category,
            description=s.description,
            default_industry=s.default_industry,
            default_action=s.default_action,
            expected_outcome=s.expected_outcome,
            expected_security_behavior=s.expected_security_behavior,
        )
        for s in SCENARIOS
    ]


@router.post("/run", response_model=SimulatorRunResponse)
def run_scenario(
    payload: SimulatorRunRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> SimulatorRunResponse:
    assert_tenant_access(operator, payload.tenant_id)
    tenant = db.get(Tenant, payload.tenant_id)
    user = db.get(EndUser, payload.user_id)
    if not tenant or not user or user.tenant_id != tenant.id:
        raise VoiceLockError(
            code="user_not_found_in_tenant",
            message="Target user not found in tenant.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    res = run_simulated_scenario(
        db,
        scenario_id=payload.scenario_id,
        tenant=tenant,
        user=user,
        action=payload.action,
        actor_reference=operator.email,
    )
    sc = res["scenario"]
    return SimulatorRunResponse(
        label=res["label"],
        scenario=SimulatorScenarioOut(
            scenario_id=sc.scenario_id,
            title=sc.title,
            category=sc.category,
            description=sc.description,
            default_industry=sc.default_industry,
            default_action=sc.default_action,
            expected_outcome=sc.expected_outcome,
            expected_security_behavior=sc.expected_security_behavior,
        ),
        session_id=res["session_id"],
        requested_action=res["requested_action"],
        industry=res["industry"],
        policy_id=res["policy_id"],
        policy_version=res["policy_version"],
        expected_outcome=res["expected_outcome"],
        actual_outcome=res["actual_outcome"],
        reason_codes=res["reason_codes"],
        triggered_rules=res["triggered_rules"],
        explanation=res["explanation"],
        token_replay_blocked=res["token_replay_blocked"],
        results=[
            VerificationResultOut(
                id=r.id,
                provider=r.provider,
                provider_mode=r.provider_mode,
                check_type=r.check_type,
                normalized_result=r.normalized_result,
                raw_verdict=r.raw_verdict,
                score_or_similarity=r.score_or_similarity,
                provider_reference=r.provider_reference,
                error_code=r.error_code,
                error_message=r.error_message,
                details_json=r.details_json,
                created_at=r.created_at,
            )
            for r in res["results"]
        ],
        audit_events=[
            AuditEventOut(
                id=ev.id,
                tenant_id=ev.tenant_id,
                tenant_name=tenant.name,
                actor_reference=ev.actor_reference,
                session_id=ev.session_id,
                event_type=ev.event_type,
                event_details=ev.event_details,
                created_at=ev.created_at,
            )
            for ev in res["audit_events"]
        ],
    )
