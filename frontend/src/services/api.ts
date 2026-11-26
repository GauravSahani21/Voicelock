import type {
  ApiErrorBody,
  AuditEventItem,
  AutomationStatus,
  Challenge,
  DashboardOverview,
  DemoOverviewState,
  DemoResetResponse,
  EndUser,
  Enrollment,
  HealthStatus,
  IndustryActionRecord,
  IndustryPolicy,
  LoginResponse,
  OperatorProfile,
  ProviderStatus,
  SandboxAnalytics,
  SandboxEnvironment,
  SandboxOverview,
  SandboxSessionItem,
  SandboxSessionList,
  SandboxVerifyResponse,
  SessionDetail,
  SimulatorRunResponse,
  SimulatorScenario,
  Tenant,
  VerifySubmissionResponse,
  WebhookDeliveryItem,
} from '../types'

const TOKEN_STORAGE_KEY = 'voicelock_access_token'

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  }
}

export class ApiClientError extends Error {
  code: string
  status: number
  details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getStoredToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!(init.body instanceof FormData) && init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(path, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const errBody = data as ApiErrorBody | null
    throw new ApiClientError(
      response.status,
      errBody?.error?.code ?? 'http_error',
      errBody?.error?.message ?? `Request failed with HTTP ${response.status}`,
      errBody?.error?.details ?? {},
    )
  }

  return data as T
}

export const api = {
  health: () => apiRequest<HealthStatus>('/api/health'),

  login: (email: string, password: string) =>
    apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiRequest<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  me: () => apiRequest<OperatorProfile>('/api/auth/me'),

  listTenants: () => apiRequest<Tenant[]>('/api/tenants'),
  createTenant: (payload: { slug: string; name: string; industry: string }) =>
    apiRequest<Tenant>('/api/tenants', { method: 'POST', body: JSON.stringify(payload) }),
  listTenantUsers: (tenantId: string) => apiRequest<EndUser[]>(`/api/tenants/${tenantId}/users`),
  createTenantUser: (
    tenantId: string,
    payload: {
      external_reference?: string
      name: string
      email?: string
      phone_reference?: string
      role: string
      metadata_json?: Record<string, unknown>
    },
  ) =>
    apiRequest<EndUser>(`/api/tenants/${tenantId}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listEnrollments: (tenantId?: string) =>
    apiRequest<Enrollment[]>(tenantId ? `/api/enrollments?tenant_id=${encodeURIComponent(tenantId)}` : '/api/enrollments'),
  enrollSpeaker: (formData: FormData) =>
    apiRequest<Enrollment>('/api/enrollments', { method: 'POST', body: formData }),
  revokeEnrollment: (enrollmentId: string) =>
    apiRequest<Enrollment>(`/api/enrollments/${enrollmentId}`, { method: 'DELETE' }),

  listSessions: (params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v)
    })
    const qs = q.toString()
    return apiRequest<SessionDetail[]>(qs ? `/api/sessions?${qs}` : '/api/sessions')
  },
  createSession: (payload: {
    tenant_id: string
    user_id: string
    requested_action: string
    resource_reference: string
    external_request_id?: string
    request_context?: Record<string, unknown>
    step_up_satisfied?: boolean
  }) => apiRequest<SessionDetail>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  getSession: (sessionId: string) => apiRequest<SessionDetail>(`/api/sessions/${sessionId}`),
  cancelSession: (sessionId: string) =>
    apiRequest<SessionDetail>(`/api/sessions/${sessionId}/cancel`, { method: 'POST' }),
  issueChallenge: (sessionId: string) =>
    apiRequest<Challenge>(`/api/sessions/${sessionId}/challenge`, { method: 'POST' }),
  verifySessionAudio: (sessionId: string, formData: FormData) =>
    apiRequest<VerifySubmissionResponse>(`/api/sessions/${sessionId}/verify`, {
      method: 'POST',
      body: formData,
    }),

  verifySessionAudioWithProgress: (
    sessionId: string,
    formData: FormData,
    onUploadComplete: () => void,
  ): Promise<VerifySubmissionResponse> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/sessions/${sessionId}/verify`)
      const token = getStoredToken()
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      }
      xhr.upload.onload = () => {
        onUploadComplete()
      }
      xhr.onload = () => {
        let parsed: unknown = null
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null
        } catch {
          parsed = null
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed as VerifySubmissionResponse)
        } else {
          const errBody = parsed as ApiErrorBody | null
          reject(
            new ApiClientError(
              xhr.status,
              errBody?.error?.code ?? 'http_error',
              errBody?.error?.message ?? `Verification failed with HTTP ${xhr.status}`,
              errBody?.error?.details ?? {},
            ),
          )
        }
      }
      xhr.onerror = () => {
        reject(new ApiClientError(0, 'network_error', 'Network error while uploading verification audio.'))
      }
      xhr.send(formData)
    }),

  listDecisions: (params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v)
    })
    const qs = q.toString()
    return apiRequest<SessionDetail[]>(qs ? `/api/decisions?${qs}` : '/api/decisions')
  },
  getDecision: (decisionId: string) => apiRequest<SessionDetail>(`/api/decisions/${decisionId}`),
  submitHumanReview: (decisionId: string, resolution: 'APPROVE' | 'REJECT', reviewer_note: string) =>
    apiRequest<{
      session: SessionDetail
      resolution: string
      authorization_token: string | null
      token_expires_at: string | null
    }>(`/api/decisions/${decisionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ resolution, reviewer_note }),
    }),

  validateToken: (payload: {
    token: string
    tenant_id: string
    user_id?: string
    action: string
    resource_reference: string
  }) =>
    apiRequest<{
      valid: boolean
      status: string
      reason_code: string
      message: string
      token_id: string | null
      session_id: string | null
      expires_at: string | null
    }>('/api/tokens/validate', { method: 'POST', body: JSON.stringify(payload) }),

  listPolicies: () => apiRequest<IndustryPolicy[]>('/api/policies'),
  getPolicy: (industry: string) => apiRequest<IndustryPolicy>(`/api/policies/${industry}`),

  listAuditEvents: (params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v)
    })
    const qs = q.toString()
    return apiRequest<AuditEventItem[]>(qs ? `/api/audit?${qs}` : '/api/audit')
  },

  providerStatus: () => apiRequest<ProviderStatus>('/api/providers/status'),

  dashboardOverview: (tenantId?: string, includeSimulated = true) => {
    const q = new URLSearchParams()
    if (tenantId) q.set('tenant_id', tenantId)
    q.set('include_simulated', String(includeSimulated))
    return apiRequest<DashboardOverview>(`/api/dashboard/overview?${q.toString()}`)
  },

  listWorkflowExecutions: (tenantId?: string, industry?: string) => {
    const q = new URLSearchParams()
    if (tenantId) q.set('tenant_id', tenantId)
    if (industry) q.set('industry', industry)
    const qs = q.toString()
    return apiRequest<IndustryActionRecord[]>(qs ? `/api/workflows/executions?${qs}` : '/api/workflows/executions')
  },
  executeWorkflowAction: (
    industry: string,
    payload: {
      tenant_id: string
      user_id: string
      action: string
      resource_reference: string
      authorization_token: string
      operation_payload?: Record<string, unknown>
    },
  ) =>
    apiRequest<IndustryActionRecord>(`/api/workflows/${industry}/execute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listSimulatorScenarios: () => apiRequest<SimulatorScenario[]>('/api/simulator/scenarios'),
  runSimulatorScenario: (payload: {
    scenario_id: string
    tenant_id: string
    user_id: string
    action?: string
  }) =>
    apiRequest<SimulatorRunResponse>('/api/simulator/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  demoOverviewState: () => apiRequest<DemoOverviewState>('/api/demo/overview-state'),
  demoBootstrap: (roleMode: 'admin' | 'telecom' | 'helpdesk' | 'banking' | 'education' = 'admin') =>
    apiRequest<LoginResponse>('/api/demo/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ role_mode: roleMode }),
    }),
  demoReset: (clearEnrollments = false) =>
    apiRequest<DemoResetResponse>('/api/demo/reset', {
      method: 'POST',
      body: JSON.stringify({ clear_enrollments: clearEnrollments }),
    }),

  sandboxEnvironments: () => apiRequest<SandboxEnvironment[]>('/api/sandbox/environments'),
  sandboxOverview: (tenantId?: string) =>
    apiRequest<SandboxOverview>(
      tenantId ? `/api/sandbox/overview?tenant_id=${encodeURIComponent(tenantId)}` : '/api/sandbox/overview',
    ),
  sandboxSessions: (params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v))
    })
    const qs = q.toString()
    return apiRequest<SandboxSessionList>(qs ? `/api/sandbox/sessions?${qs}` : '/api/sandbox/sessions')
  },
  createSandboxSession: (payload: {
    industry: string
    scenario_id?: string
    tenant_id?: string
    user_id?: string
    requested_action?: string
    resource_reference?: string
    attack_type?: string
    input_type?: string
  }) =>
    apiRequest<SandboxSessionItem>('/api/sandbox/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSandboxSession: (sandboxSessionId: string) =>
    apiRequest<SandboxSessionItem>(`/api/sandbox/sessions/${sandboxSessionId}`),
  verifySandboxSession: (sandboxSessionId: string, formData: FormData) =>
    apiRequest<SandboxVerifyResponse>(`/api/sandbox/sessions/${sandboxSessionId}/verify`, {
      method: 'POST',
      body: formData,
    }),
  sandboxAnalytics: () => apiRequest<SandboxAnalytics>('/api/sandbox/analytics'),

  automationStatus: () => apiRequest<AutomationStatus>('/api/automation/status'),
  automationToggle: (enabled: boolean) =>
    apiRequest<AutomationStatus>('/api/automation/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  automationTestWebhook: () =>
    apiRequest<WebhookDeliveryItem>('/api/automation/test-webhook', { method: 'POST' }),
  automationDeliveries: (statusFilter?: string) =>
    apiRequest<WebhookDeliveryItem[]>(
      statusFilter
        ? `/api/automation/deliveries?status=${encodeURIComponent(statusFilter)}`
        : '/api/automation/deliveries',
    ),
  automationRetryDelivery: (deliveryId: string) =>
    apiRequest<WebhookDeliveryItem>(`/api/automation/deliveries/${deliveryId}/retry`, {
      method: 'POST',
    }),
}
