import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Smartphone,
  KeyRound,
  Landmark,
  GraduationCap,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Lock,
  ShieldAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api, ApiClientError } from '../services/api'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { AudioRecorderPanel } from '../components/audio/AudioRecorderPanel'
import { OutcomeBadge, ProvenanceBadge, RiskBadge } from '../components/ui/Badges'
import { CopyButton } from '../components/ui/CopyButton'
import type {
  Challenge,
  EndUser,
  IndustryActionRecord,
  IndustryPolicy,
  IndustryType,
  SessionDetail,
  Tenant,
  VerifySubmissionResponse,
} from '../types'

const INDUSTRY_TABS: {
  id: IndustryType
  title: string
  subtitle: string
  icon: typeof Smartphone
}[] = [
  { id: 'telecom', title: 'Telecom — SIM Replacement', subtitle: 'Primary Demo Workflow', icon: Smartphone },
  { id: 'helpdesk', title: 'IT Helpdesk — MFA Reset', subtitle: 'Secondary Demo Workflow', icon: KeyRound },
  { id: 'banking', title: 'Banking — Account Guard', subtitle: 'Simulated Banking Adapter', icon: Landmark },
  { id: 'education', title: 'Education — Campus Portal', subtitle: 'Role-Scoped Adapter', icon: GraduationCap },
]

export function IndustryWorkflows() {
  const { tenants } = useAuth()
  const [activeIndustry, setActiveIndustry] = useState<IndustryType>('telecom')
  const [users, setUsers] = useState<EndUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [policy, setPolicy] = useState<IndustryPolicy | null>(null)
  const [selectedAction, setSelectedAction] = useState('')
  const [resourceRef, setResourceRef] = useState('')
  const [newSimIccid, setNewSimIccid] = useState('890141032199990042')
  const [stepUpConfirmed, setStepUpConfirmed] = useState(false)

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [verifyRes, setVerifyRes] = useState<VerifySubmissionResponse | null>(null)
  const [executionRecord, setExecutionRecord] = useState<IndustryActionRecord | null>(null)
  const [executionsHistory, setExecutionsHistory] = useState<IndustryActionRecord[]>([])
  const [attackProbeMsg, setAttackProbeMsg] = useState<string | null>(null)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorder = useAudioRecorder()

  const tenantForIndustry: Tenant | undefined = tenants.find((t) => t.industry === activeIndustry)

  const refreshHistory = async (tid?: string) => {
    try {
      const list = await api.listWorkflowExecutions(tid, activeIndustry)
      setExecutionsHistory(list)
    } catch {
      setExecutionsHistory([])
    }
  }

  useEffect(() => {
    setSession(null)
    setChallenge(null)
    setVerifyRes(null)
    setExecutionRecord(null)
    setAttackProbeMsg(null)
    setError(null)
    recorder.clearRecording()

    if (!tenantForIndustry) {
      setUsers([])
      setPolicy(null)
      return
    }

    Promise.all([
      api.listTenantUsers(tenantForIndustry.id),
      api.getPolicy(activeIndustry),
    ])
      .then(([userList, pol]) => {
        setUsers(userList)
        setSelectedUserId(userList[0]?.id ?? '')
        setPolicy(pol)
        const defaultAction =
          activeIndustry === 'telecom'
            ? 'sim_replacement'
            : activeIndustry === 'helpdesk'
              ? 'mfa_reset'
              : pol.actions[0]?.action ?? ''
        setSelectedAction(defaultAction)
        setResourceRef(`${activeIndustry.toUpperCase()}-REQ-${Math.floor(10000 + Math.random() * 89999)}`)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load workflow'))

    void refreshHistory(tenantForIndustry.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndustry, tenantForIndustry?.id])

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null
  const actionPolicy = policy?.actions.find((a) => a.action === selectedAction) ?? null

  const handleStartRequest = async () => {
    if (!tenantForIndustry || !selectedUserId || !selectedAction || !resourceRef.trim()) return
    setError(null)
    setVerifyRes(null)
    setExecutionRecord(null)
    setAttackProbeMsg(null)
    setBusy('Requesting fresh challenge from VoiceLock Gateway...')
    try {
      const sess = await api.createSession({
        tenant_id: tenantForIndustry.id,
        user_id: selectedUserId,
        requested_action: selectedAction,
        resource_reference: resourceRef.trim(),
        external_request_id: `${activeIndustry.toUpperCase()}-${Date.now().toString().slice(-5)}`,
        step_up_satisfied: stepUpConfirmed,
        request_context: { simulated_app: activeIndustry, user_role: selectedUser?.role },
      })
      const ch = await api.issueChallenge(sess.id)
      setSession(sess)
      setChallenge(ch)
      recorder.clearRecording()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to start verification')
    } finally {
      setBusy(null)
    }
  }

  const handleVerifyCaller = async () => {
    if (!session || !challenge || !recorder.recording) return
    setError(null)
    setBusy('Running VoiceLock checks (STT + Detectif Aletheia + Detectif Eidos + Policy)...')
    try {
      const fd = new FormData()
      fd.append('challenge_id', challenge.id)
      fd.append('file', recorder.recording.file)
      const res = await api.verifySessionAudio(session.id, fd)
      setVerifyRes(res)
      setSession(res.session)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Verification failed')
    } finally {
      setBusy(null)
    }
  }

  const handleExecuteProtectedOp = async () => {
    if (!tenantForIndustry || !selectedUserId || !verifyRes?.authorization_token) return
    setError(null)
    setAttackProbeMsg(null)
    setBusy('Validating & consuming action-bound token before executing protected operation...')
    try {
      const rec = await api.executeWorkflowAction(activeIndustry, {
        tenant_id: tenantForIndustry.id,
        user_id: selectedUserId,
        action: selectedAction,
        resource_reference: session?.resource_reference || resourceRef,
        authorization_token: verifyRes.authorization_token,
        operation_payload:
          activeIndustry === 'telecom' ? { new_sim_iccid: newSimIccid } : { initiated_via: 'voicelock_demo' },
      })
      setExecutionRecord(rec)
      await refreshHistory(tenantForIndustry.id)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Protected operation blocked')
    } finally {
      setBusy(null)
    }
  }

  const handleProbeTokenAbuse = async (mode: 'replay' | 'cross_action') => {
    if (!tenantForIndustry || !selectedUserId || !verifyRes?.authorization_token) return
    setAttackProbeMsg(null)
    const targetAction =
      mode === 'cross_action'
        ? selectedAction === 'mfa_reset'
          ? 'privileged_access_restoration'
          : policy?.actions.find((a) => a.action !== selectedAction)?.action || 'port_out_request'
        : selectedAction

    try {
      await api.executeWorkflowAction(activeIndustry, {
        tenant_id: tenantForIndustry.id,
        user_id: selectedUserId,
        action: targetAction,
        resource_reference: session?.resource_reference || resourceRef,
        authorization_token: verifyRes.authorization_token,
      })
      setAttackProbeMsg('Unexpectedly succeeded')
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setAttackProbeMsg(
          `BLOCKED (${err.status} ${err.code}): ${err.message}`,
        )
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Industry Workflows (One Gateway, Four Sectors)</h1>
        <p className="text-sm text-slate-500">
          Simulated enterprise applications calling the same VoiceLock Gateway API. Each application
          refuses to execute sensitive operations until a valid, single-use, action-bound token is consumed.
        </p>
      </div>

      {/* Industry Selector Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {INDUSTRY_TABS.map((tab) => {
          const Icon = tab.icon
          const active = activeIndustry === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveIndustry(tab.id)}
              className={`text-left rounded-xl border p-3.5 transition-colors ${
                active
                  ? 'border-blue-600 bg-blue-50/70 ring-1 ring-blue-600'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${active ? 'text-blue-600' : 'text-slate-500'}`} aria-hidden="true" />
                <span className="text-sm font-semibold text-slate-900">{tab.title}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{tab.subtitle}</div>
            </button>
          )
        })}
      </div>

      {!tenantForIndustry ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          Your signed-in operator account is scoped to a different tenant/industry. Sign in as{' '}
          <code>admin@voicelock.demo</code> (Platform Admin) to switch across all four industry demonstrations.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Simulated App Form */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                    SIMULATED {activeIndustry.toUpperCase()} APPLICATION
                  </span>
                  <h2 className="text-base font-semibold text-slate-900 mt-1.5">
                    {tenantForIndustry.name} — Sensitive Action Console
                  </h2>
                </div>
                {actionPolicy && <RiskBadge risk={actionPolicy.risk_level} />}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="wf-user" className="block text-xs font-medium text-slate-700 mb-1">
                    Select {activeIndustry === 'telecom' ? 'Customer' : activeIndustry === 'helpdesk' ? 'Employee' : 'Account Holder'}
                  </label>
                  <select
                    id="wf-user"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role}) — {u.enrollment_status ?? 'not_enrolled'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="wf-action" className="block text-xs font-medium text-slate-700 mb-1">
                    Requested Operation
                  </label>
                  <select
                    id="wf-action"
                    value={selectedAction}
                    onChange={(e) => setSelectedAction(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {policy?.actions.map((a) => (
                      <option key={a.action} value={a.action}>
                        {a.label} ({a.risk_level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="wf-res" className="block text-xs font-medium text-slate-700 mb-1">
                    {activeIndustry === 'telecom' ? 'SIM Replacement Request ID' : 'Request / Ticket Reference'}
                  </label>
                  <input
                    id="wf-res"
                    type="text"
                    value={resourceRef}
                    onChange={(e) => setResourceRef(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </div>

                {activeIndustry === 'telecom' && (
                  <div>
                    <label htmlFor="wf-iccid" className="block text-xs font-medium text-slate-700 mb-1">
                      Target Replacement ICCID
                    </label>
                    <input
                      id="wf-iccid"
                      type="text"
                      value={newSimIccid}
                      onChange={(e) => setNewSimIccid(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>
                )}
              </div>

              {selectedUser && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 flex flex-wrap justify-between gap-2">
                  <span>Ref: <strong className="font-mono text-slate-800">{selectedUser.external_reference}</strong></span>
                  <span>Role: <strong className="text-slate-800">{selectedUser.role}</strong></span>
                  <span>Voice Enrollment: <strong className="text-slate-800">{selectedUser.enrollment_status}</strong></span>
                </div>
              )}

              {actionPolicy?.always_require_step_up && (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={stepUpConfirmed}
                    onChange={(e) => setStepUpConfirmed(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Secondary factor / supervisor approval verified</span>
                </label>
              )}

              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void handleStartRequest()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4 text-blue-400" aria-hidden="true" />
                <span>Send Request to VoiceLock Gateway</span>
              </button>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {session && challenge && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="rounded-lg bg-slate-900 text-white p-3.5">
                  <div className="text-[11px] uppercase tracking-wider text-blue-300 font-semibold">
                    VoiceLock Challenge Issued
                  </div>
                  <div className="text-base font-bold mt-0.5">&ldquo;{challenge.challenge_text}&rdquo;</div>
                </div>

                {!verifyRes && (
                  <>
                    <AudioRecorderPanel
                      title="Caller Voice Verification"
                      minDurationSeconds={actionPolicy?.require_eidos ? 3 : 2}
                      maxDurationSeconds={actionPolicy?.require_eidos ? 60 : 300}
                      isRecording={recorder.isRecording}
                      elapsedSeconds={recorder.elapsedSeconds}
                      audioLevel={recorder.audioLevel}
                      recording={recorder.recording}
                      recorderError={recorder.recorderError}
                      onStart={() => void recorder.startRecording()}
                      onStop={recorder.stopRecording}
                      onRetake={recorder.clearRecording}
                      onUploadFile={(f) => void recorder.setUploadedFile(f)}
                      disabled={Boolean(busy)}
                    />
                    <button
                      type="button"
                      disabled={!recorder.recording || recorder.isRecording || Boolean(busy)}
                      onClick={() => void handleVerifyCaller()}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ?? 'Verify Caller with VoiceLock'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: Gateway Decision & Action Execution */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Gateway Decision &amp; Protected Execution
              </h2>

              {!verifyRes ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
                  Start a sensitive request and submit caller audio. The simulated {activeIndustry} app will
                  remain locked until VoiceLock returns <code>PASS</code> and issues a valid token.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <OutcomeBadge outcome={verifyRes.decision.outcome} />
                    <Link
                      to={`/security/decisions/${verifyRes.session.id}`}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Inspect Full Decision &rarr;
                    </Link>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">{verifyRes.decision.explanation}</p>

                  <div className="space-y-2">
                    {verifyRes.session.verification_results.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs rounded border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                        <span className="font-medium capitalize">{r.check_type.replaceAll('_', ' ')}</span>
                        <div className="flex items-center gap-2">
                          <ProvenanceBadge mode={r.provider_mode} />
                          <span className="font-mono font-semibold">{r.normalized_result}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {verifyRes.authorization_token ? (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-semibold text-emerald-900">
                          <span>One-Time Authorization Token</span>
                          <CopyButton text={verifyRes.authorization_token} label="Copy workflow token" />
                        </div>
                        <div className="font-mono text-[11px] break-all text-emerald-950">
                          {verifyRes.authorization_token}
                        </div>
                      </div>

                      {!executionRecord ? (
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => void handleExecuteProtectedOp()}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Lock className="h-4 w-4" aria-hidden="true" />
                          <span>Consume Token &amp; Execute {selectedAction}</span>
                        </button>
                      ) : (
                        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-2">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                            <span>Protected Operation Executed</span>
                          </div>
                          <p>{executionRecord.summary}</p>
                        </div>
                      )}

                      {/* Live Action-Binding & Replay Probes */}
                      <div className="pt-2 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          Verify Action-Binding &amp; Replay Defense
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleProbeTokenAbuse('cross_action')}
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Test Token on Wrong Action
                          </button>
                          {executionRecord && (
                            <button
                              type="button"
                              onClick={() => void handleProbeTokenAbuse('replay')}
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Test Replay Token
                            </button>
                          )}
                        </div>
                        {attackProbeMsg && (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-start gap-2">
                            <ShieldAlert className="h-4 w-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{attackProbeMsg}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                      Protected operation remains <strong>LOCKED</strong> — no authorization token was issued.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Simulated Execution History */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Executed {activeIndustry} Operations ({executionsHistory.length})
              </h3>
              {executionsHistory.length === 0 ? (
                <p className="text-xs text-slate-500">No operations executed yet.</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {executionsHistory.map((ex) => (
                    <li key={ex.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs space-y-1">
                      <div className="flex justify-between font-semibold text-slate-800">
                        <span className="font-mono">{ex.action}</span>
                        <span className="text-emerald-700">{ex.execution_status}</span>
                      </div>
                      <p className="text-slate-600">{ex.summary}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
