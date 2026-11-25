import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Headphones,
  LayoutGrid,
  User,
  Laptop,
  Shield,
  FileText,
  ArrowLeft,
  KeyRound,
  Lock,
  Phone,
  RefreshCw,
  Unlock,
  ShieldAlert,
  CheckCircle2,
  Mic,
  AlertTriangle,
  UserPlus,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLivePolling } from '../../hooks/useLivePolling'
import { api, ApiClientError } from '../../services/api'
import { VoiceLockVerification } from '../../components/voicelock/VoiceLockVerification'
import { QuickEnrollModal } from '../../components/voicelock/QuickEnrollModal'
import { RegisterUserModal } from '../../components/voicelock/RegisterUserModal'
import type { EndUser, IndustryActionRecord, Tenant, VerifySubmissionResponse } from '../../types'

type HelpdeskNav = 'dashboard' | 'profile' | 'devices' | 'security' | 'requests'

const HELPDESK_ACTIONS = [
  {
    action: 'mfa_reset',
    label: 'Reset My MFA',
    description: 'Reset lost authenticator app or hardware security key.',
    icon: KeyRound,
    primary: true,
    requireEidos: true,
    stepUp: false,
  },
  {
    action: 'password_reset',
    label: 'Reset Password',
    description: 'Issue a temporary SSO password reset link.',
    icon: Lock,
    primary: false,
    requireEidos: true,
    stepUp: false,
  },
  {
    action: 'registered_phone_change',
    label: 'Change Registered Phone',
    description: 'Update SMS recovery phone on employee directory.',
    icon: Phone,
    primary: false,
    requireEidos: true,
    stepUp: false,
  },
  {
    action: 'device_reregistration',
    label: 'Re-register Device',
    description: 'Re-enroll corporate laptop MDM trust certificate.',
    icon: RefreshCw,
    primary: false,
    requireEidos: true,
    stepUp: false,
  },
  {
    action: 'account_unlock',
    label: 'Unlock Account',
    description: 'Clear directory lockout (Aletheia + Challenge policy).',
    icon: Unlock,
    primary: false,
    requireEidos: false,
    stepUp: false,
  },
  {
    action: 'privileged_access_restoration',
    label: 'Request Privileged Access',
    description: 'Restore production IAM break-glass role (requires step-up).',
    icon: ShieldAlert,
    primary: false,
    requireEidos: true,
    stepUp: false,
  },
]

export function EmployeeHelpdeskPortal() {
  const { ensureDemoSession } = useAuth()
  const [nav, setNav] = useState<HelpdeskNav>('dashboard')
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [users, setUsers] = useState<EndUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [executions, setExecutions] = useState<IndustryActionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeAction, setActiveAction] = useState<(typeof HELPDESK_ACTIONS)[number] | null>(null)
  const [ticketId, setTicketId] = useState('')
  const [lastToken, setLastToken] = useState<string | null>(null)
  const [confirmedRecord, setConfirmedRecord] = useState<IndustryActionRecord | null>(null)
  const [crossActionProbe, setCrossActionProbe] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [enrollModalOpen, setEnrollModalOpen] = useState(false)
  const [registerModalOpen, setRegisterModalOpen] = useState(false)

  const loadPortal = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const tenantList = await ensureDemoSession('admin')
        const ent = tenantList.find((t) => t.industry === 'helpdesk')
        if (!ent) {
          setError('Demo Enterprise tenant not found.')
          setLoading(false)
          return
        }
        setTenant(ent)
        const [uList, execList] = await Promise.all([
          api.listTenantUsers(ent.id),
          api.listWorkflowExecutions(ent.id, 'helpdesk'),
        ])
        setUsers(uList)
        setExecutions(execList)
        setSelectedUserId((prev) => prev || uList[0]?.id || '')
        if (!silent) setError(null)
      } catch (err: unknown) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Unable to load IT Helpdesk Portal')
        }
      } finally {
        setLoading(false)
      }
    },
    [ensureDemoSession],
  )

  useEffect(() => {
    void loadPortal(false)
  }, [loadPortal])

  useLivePolling(
    () => {
      void loadPortal(true)
    },
    { intervalMs: 6000, enabled: !activeAction },
  )

  const employee = users.find((u) => u.id === selectedUserId) ?? users[0] ?? null
  const meta = (employee?.metadata_json ?? {}) as Record<string, unknown>

  const startOperation = (item: (typeof HELPDESK_ACTIONS)[number]) => {
    setActiveAction(item)
    setTicketId(`INC-${Date.now().toString().slice(-6)}`)
    setConfirmedRecord(null)
    setCrossActionProbe(null)
    setLastToken(null)
    setError(null)
  }

  const handleVerified = (res: VerifySubmissionResponse) => {
    if (res.authorization_token) {
      setLastToken(res.authorization_token)
    }
    void loadPortal(true)
  }

  const handleExecute = async (res: VerifySubmissionResponse) => {
    if (!tenant || !employee || !activeAction || !res.authorization_token) return
    setExecuting(true)
    setError(null)
    try {
      const rec = await api.executeWorkflowAction('helpdesk', {
        tenant_id: tenant.id,
        user_id: employee.id,
        action: activeAction.action,
        resource_reference: ticketId,
        authorization_token: res.authorization_token,
      })
      setConfirmedRecord(rec)
      await loadPortal()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Helpdesk operation denied')
    } finally {
      setExecuting(false)
    }
  }

  const handleTestCrossAction = async () => {
    if (!tenant || !employee || !lastToken || !activeAction) return
    const otherAction = activeAction.action === 'mfa_reset' ? 'privileged_access_restoration' : 'mfa_reset'
    try {
      await api.executeWorkflowAction('helpdesk', {
        tenant_id: tenant.id,
        user_id: employee.id,
        action: otherAction,
        resource_reference: ticketId,
        authorization_token: lastToken,
      })
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setCrossActionProbe(
          `Blocked cross-action attempt (${otherAction}): HTTP ${err.status} ${err.code} — ${err.message}`,
        )
      }
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-950 flex flex-col">
      {/* Minimal Frosted Header */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-zinc-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 min-h-16 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-950 pr-2.5 border-r border-zinc-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Demo Hub</span>
            </Link>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <Headphones className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-950 truncate">AcmeCorp IT Service Desk</div>
                <div className="text-[11px] text-zinc-500 truncate">Employee Identity Portal</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            {users.length > 0 && (
              <select
                aria-label="Select demo employee"
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value)
                  setActiveAction(null)
                }}
                className="min-w-0 max-w-[175px] sm:max-w-none rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={!tenant}
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 shrink-0 transition-colors disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Register</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <aside className="lg:col-span-3 space-y-5">
          <nav aria-label="Helpdesk menu" className="space-y-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
              { id: 'profile', label: 'My Profile', icon: User },
              { id: 'devices', label: 'Device Management', icon: Laptop },
              { id: 'security', label: 'Account Security', icon: Shield },
              { id: 'requests', label: 'Helpdesk Requests', icon: FileText },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setNav(id as HelpdeskNav)}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  nav === id
                    ? 'bg-zinc-950 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {employee && (
            <div className="vl-surface rounded-2xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-zinc-950">Employee Voiceprint</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    employee.enrollment_status === 'enrolled'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {employee.enrollment_status === 'enrolled' ? 'Enrolled' : 'Missing'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEnrollModalOpen(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50 transition-colors"
              >
                <Mic className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>{employee.enrollment_status === 'enrolled' ? 'Re-Enroll Voice' : 'Enroll Demo Voice (15s)'}</span>
              </button>
            </div>
          )}
        </aside>

        <main className="lg:col-span-9 space-y-6">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="vl-surface rounded-2xl p-12 text-center text-sm text-zinc-500">
              Loading employee helpdesk portal...
            </div>
          ) : employee ? (
            <>
              {(nav === 'dashboard' || nav === 'security') && !activeAction && (
                <div className="space-y-6">
                  <div className="vl-surface rounded-2xl p-6 sm:p-7 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                        Employee Account · <span className="font-mono">{employee.external_reference}</span>
                      </div>
                      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                        {employee.name.split(' (')[0]}
                      </h1>
                      <p className="text-sm text-zinc-500">
                        {String(meta.designation ?? 'Staff Engineer')} · {String(meta.department ?? 'Engineering')} ·{' '}
                        {employee.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startOperation(HELPDESK_ACTIONS[0])}
                      className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                    >
                      Reset My MFA
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-sm">
                    <InfoTile label="Account Status" value="Active · Directory Synced" />
                    <InfoTile label="Registered Device" value={String(meta.registered_device ?? 'MacBook Pro 16')} />
                    <InfoTile label="MFA Device" value={String(meta.mfa_device ?? 'Hardware Token')} />
                    <InfoTile label="MFA Status" value={String(meta.mfa_status ?? 'Enrolled')} />
                  </div>

                  <section className="space-y-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Protected Self-Service Actions (Action-Bound Authorization)
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {HELPDESK_ACTIONS.map((item) => {
                        const Icon = item.icon
                        return (
                          <div
                            key={item.action}
                            className="vl-surface-interactive rounded-2xl p-5 flex flex-col justify-between gap-4"
                          >
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between">
                                <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                                </div>
                                {item.primary && (
                                  <span className="rounded-full bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <div>
                                <h3 className="text-sm font-semibold text-zinc-950">{item.label}</h3>
                                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{item.description}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => startOperation(item)}
                              className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors"
                            >
                              Request {item.label}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                </div>
              )}

              {activeAction && tenant && (
                <div className="space-y-4">
                  <div className="vl-surface rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-zinc-500 font-mono">Ticket {ticketId}</div>
                      <div className="text-base font-semibold text-zinc-950 mt-0.5">
                        {activeAction.label} — {employee.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveAction(null)}
                      className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Back to Helpdesk
                    </button>
                  </div>

                  {!confirmedRecord ? (
                    <VoiceLockVerification
                      tenantId={tenant.id}
                      userId={employee.id}
                      action={activeAction.action}
                      actionLabel={activeAction.label}
                      resourceReference={ticketId}
                      maskedAccountDisplay={employee.email ?? employee.external_reference}
                      requireEidos={activeAction.requireEidos}
                      stepUpSatisfied={activeAction.stepUp}
                      onVerified={handleVerified}
                      onContinueAction={(res) => void handleExecute(res)}
                      continuing={executing}
                      onCancel={() => setActiveAction(null)}
                    />
                  ) : (
                    <div className="vl-surface rounded-2xl border-emerald-200 p-6 space-y-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">
                            {activeAction.label} Authorized &amp; Completed
                          </h2>
                          <p className="text-sm text-zinc-600 mt-1">{confirmedRecord.summary}</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-2.5 text-xs">
                        <div className="font-semibold text-zinc-950">
                          Action-Bound Security Verification Check
                        </div>
                        <p className="text-zinc-600">
                          This authorization token was bound exclusively to{' '}
                          <code>{activeAction.action}</code> on ticket <code>{ticketId}</code> and has now been
                          consumed.
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleTestCrossAction()}
                          className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100"
                        >
                          Verify Token Cannot Authorize Another Action
                        </button>
                        {crossActionProbe && (
                          <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-rose-800">
                            {crossActionProbe}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2.5">
                        <button
                          type="button"
                          onClick={() => setActiveAction(null)}
                          className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-medium text-white"
                        >
                          Done
                        </button>
                        <Link
                          to={`/security/decisions/${confirmedRecord.session_id}`}
                          className="rounded-full border border-zinc-200 bg-white px-5 py-2 text-xs font-medium text-zinc-700"
                        >
                          Inspect Audit Record
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {nav === 'profile' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                  <InfoTile label="Full Name" value={employee.name} />
                  <InfoTile label="Employee ID" value={employee.external_reference} />
                  <InfoTile label="Department" value={String(meta.department ?? 'Engineering')} />
                  <InfoTile label="Designation" value={String(meta.designation ?? 'Staff SRE')} />
                  <InfoTile label="Work Email" value={employee.email ?? 'employee@demoenterprise.example'} />
                  <InfoTile label="Registered Phone" value={String(meta.masked_phone ?? employee.phone_reference)} />
                </div>
              )}

              {nav === 'devices' && (
                <div className="vl-surface rounded-2xl p-6 space-y-4">
                  <h2 className="text-lg font-semibold text-zinc-950">Managed Corporate Devices</h2>
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-950">
                        {String(meta.registered_device ?? 'MacBook Pro 16')}
                      </div>
                      <div className="text-xs text-zinc-500">
                        MFA Factor: {String(meta.mfa_device ?? 'Hardware Token')} · {String(meta.mfa_status ?? 'Enrolled')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startOperation(HELPDESK_ACTIONS[3])}
                      className="rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
                    >
                      Re-register Device
                    </button>
                  </div>
                </div>
              )}

              {nav === 'requests' && (
                <div className="vl-surface rounded-2xl p-6 space-y-3">
                  <h2 className="text-lg font-semibold text-zinc-950">Helpdesk Execution History</h2>
                  {executions.length === 0 ? (
                    <p className="text-sm text-zinc-500">No helpdesk operations executed yet.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100">
                      {executions.map((ex) => (
                        <li key={ex.id} className="py-3 text-xs space-y-1 first:pt-1 last:pb-0">
                          <div className="flex justify-between font-semibold">
                            <span className="font-mono text-zinc-950">{ex.action} ({ex.resource_reference})</span>
                            <span className="text-emerald-700">{ex.execution_status}</span>
                          </div>
                          <p className="text-zinc-600">{ex.summary}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>

      {tenant && employee && (
        <QuickEnrollModal
          open={enrollModalOpen}
          tenantId={tenant.id}
          userId={employee.id}
          userName={employee.name}
          onEnrolled={() => void loadPortal(true)}
          onClose={() => setEnrollModalOpen(false)}
        />
      )}

      {tenant && (
        <RegisterUserModal
          open={registerModalOpen}
          tenantId={tenant.id}
          tenantName={tenant.name}
          industry="helpdesk"
          onRegistered={(user) => {
            setSelectedUserId(user.id)
            setActiveAction(null)
            void loadPortal(true)
          }}
          onClose={() => setRegisterModalOpen(false)}
        />
      )}
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="vl-surface rounded-2xl p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-950 mt-1.5 vl-nums">{value}</div>
    </div>
  )
}
