export type IndustryType = 'telecom' | 'helpdesk' | 'banking' | 'education'
export type OutcomeType = 'PASS' | 'STEP_UP' | 'REVIEW' | 'REJECT'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  app_name: string
  environment: string
  database: 'connected' | 'unavailable'
  detectif_provider_mode: 'live' | 'mock'
  aletheia_enabled: boolean
  eidos_enabled: boolean
  whisper_model: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  request_id?: string
}

export interface OperatorProfile {
  id: string
  email: string
  full_name: string
  role: string
  tenant_id: string | null
  tenant_name: string | null
  tenant_industry: string | null
  is_active: boolean
  created_at: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_at: string
  operator: OperatorProfile
}

export interface Tenant {
  id: string
  slug: string
  name: string
  industry: IndustryType
  status: string
  created_at: string
}

export interface EndUser {
  id: string
  tenant_id: string
  external_reference: string
  name: string
  email: string | null
  phone_reference: string | null
  role: string
  status: string
  metadata_json: Record<string, unknown>
  created_at: string
  enrollment_status: string | null
}

export interface Enrollment {
  id: string
  tenant_id: string
  tenant_name?: string | null
  user_id: string
  user_name: string
  user_external_reference: string
  provider_name: string
  provider_mode: string
  provider_speaker_reference?: string | null
  sample_count: number
  enrollment_status: string
  consent_status: string
  consent_recorded_at: string | null
  last_operation_id: string | null
  quality_metadata: Record<string, unknown>
  enrolled_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface Challenge {
  id: string
  session_id: string
  challenge_text: string
  status: string
  created_at: string
  expires_at: string
  consumed_at: string | null
}

export interface VerificationResultItem {
  id: string
  provider: string
  provider_mode: string
  check_type: string
  normalized_result: string
  raw_verdict: string | null
  score_or_similarity: number | null
  provider_reference: string | null
  error_code: string | null
  error_message: string | null
  details_json: Record<string, unknown>
  created_at: string
}

export interface Decision {
  id: string
  session_id: string
  outcome: OutcomeType
  reason_codes: string[]
  explanation: string
  triggered_rules: string[]
  policy_id: string
  policy_version: string
  created_at: string
}

export interface TokenSummary {
  id: string
  session_id: string
  tenant_id: string
  user_id: string
  action: string
  resource_reference: string
  status: string
  created_at: string
  expires_at: string
  consumed_at: string | null
}

export interface SessionDetail {
  id: string
  tenant_id: string
  tenant_name: string
  industry: string
  user_id: string
  user_name: string
  user_external_reference: string
  user_role: string
  external_request_id: string | null
  requested_action: string
  resource_reference: string
  policy_id: string
  policy_version: string
  source_mode: string
  status: string
  step_up_satisfied: boolean
  request_context: Record<string, unknown>
  created_at: string
  expires_at: string
  latest_challenge: Challenge | null
  verification_results: VerificationResultItem[]
  decision: Decision | null
  token_summary: TokenSummary | null
}

export interface VerifySubmissionResponse {
  session: SessionDetail
  decision: Decision
  authorization_token: string | null
  token_expires_at: string | null
  token_summary: TokenSummary | null
}

export interface ActionPolicy {
  action: string
  label: string
  description: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  require_aletheia: boolean
  require_eidos: boolean
  require_challenge: boolean
  token_ttl_seconds: number
  always_require_step_up: boolean
  synthetic_voice_outcome: string
  speaker_mismatch_outcome: string
  missing_enrollment_outcome: string
  provider_outage_outcome: string
  allowed_user_roles: string[] | null
  additional_verification_notes: string
}

export interface IndustryPolicy {
  policy_id: string
  industry: IndustryType
  version: string
  display_name: string
  description: string
  actions: ActionPolicy[]
}

export interface AuditEventItem {
  id: string
  tenant_id: string | null
  tenant_name: string | null
  actor_reference: string
  session_id: string | null
  event_type: string
  event_details: Record<string, unknown>
  created_at: string
}

export interface DashboardOverview {
  total_requests: number
  evaluated_requests: number
  pending_requests: number
  expired_or_cancelled_requests: number
  live_workflow_requests: number
  simulated_scenario_requests: number
  approved_requests: number
  rejected_requests: number
  review_requests: number
  step_up_requests: number
  failed_provider_checks: number
  active_enrollments: number
  decision_distribution: Record<string, number>
  industry_activity: Record<string, number>
  recent_suspicious_requests: SessionDetail[]
  recent_activity: AuditEventItem[]
  generated_at: string
}

export interface ProviderStatus {
  provider_mode: 'live' | 'mock'
  api_key_configured: boolean
  detectif_base_url: string
  aletheia_enabled: boolean
  eidos_enabled: boolean
  whisper_model: string
  detectif_health: Record<string, unknown>
  detectif_credits: Record<string, unknown> | null
  credits_error: string | null
}

export interface IndustryActionRecord {
  id: string
  tenant_id: string
  user_id: string
  session_id: string
  token_id: string
  industry: string
  action: string
  resource_reference: string
  execution_status: string
  summary: string
  payload_json: Record<string, unknown>
  created_at: string
}

export interface SimulatorScenario {
  scenario_id: string
  title: string
  category: string
  description: string
  default_industry: string
  default_action: string
  expected_outcome: string
  expected_security_behavior: string
}

export interface SimulatorRunResponse {
  label: string
  scenario: SimulatorScenario
  session_id: string
  requested_action: string
  industry: string
  policy_id: string
  policy_version: string
  expected_outcome: string
  actual_outcome: OutcomeType
  reason_codes: string[]
  triggered_rules: string[]
  explanation: string
  token_replay_blocked: boolean
  results: VerificationResultItem[]
  audit_events: AuditEventItem[]
}

export interface DemoPortalSummary {
  tenant_id: string
  slug: string
  name: string
  industry: IndustryType
  enrolled_users: number
  total_users: number
}

export interface DemoOverviewState {
  demo_enabled: boolean
  provider_mode: 'live' | 'mock'
  portals: DemoPortalSummary[]
}

export interface DemoResetResponse {
  status: string
  sessions_cleared: number
  enrollments_cleared: number
  tenants_seeded: number
}
