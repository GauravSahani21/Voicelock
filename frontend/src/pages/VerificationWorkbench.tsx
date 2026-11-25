import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
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
  IndustryPolicy,
  SessionDetail,
  VerifySubmissionResponse,
} from '../types'

export function VerificationWorkbench() {
  const { tenants, selectedTenantId, setSelectedTenantId } = useAuth()
  const [tenantId, setTenantId] = useState(selectedTenantId || '')
  const [users, setUsers] = useState<EndUser[]>([])
  const [userId, setUserId] = useState('')
  const [policy, setPolicy] = useState<IndustryPolicy | null>(null)
  const [action, setAction] = useState('')
  const [resourceRef, setResourceRef] = useState('')
  const [stepUpSatisfied, setStepUpSatisfied] = useState(false)

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number>(0)
  const [verifyResult, setVerifyResult] = useState<VerifySubmissionResponse | null>(null)

  const [busyStep, setBusyStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorder = useAudioRecorder()

  useEffect(() => {
    if (!tenantId && selectedTenantId) setTenantId(selectedTenantId)
    else if (!tenantId && tenants.length > 0) setTenantId(tenants[0].id)
  }, [selectedTenantId, tenants, tenantId])

  const currentTenant = tenants.find((t) => t.id === tenantId) ?? null

  useEffect(() => {
    if (!currentTenant) return
    setSession(null)
    setChallenge(null)
    setVerifyResult(null)
    setError(null)
    recorder.clearRecording()

    Promise.all([
      api.listTenantUsers(currentTenant.id),
      api.getPolicy(currentTenant.industry),
    ])
      .then(([userList, pol]) => {
        setUsers(userList)
        setUserId(userList[0]?.id ?? '')
        setPolicy(pol)
        const firstAct = pol.actions[0]?.action ?? ''
        setAction(firstAct)
        setResourceRef(`${currentTenant.industry.toUpperCase()}-REQ-${Math.floor(1000 + Math.random() * 9000)}`)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load tenant details'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant?.id])

  useEffect(() => {
    if (!challenge) {
      setSecondsLeft(0)
      return
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(challenge.expires_at).getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [challenge])

  const selectedActionPolicy = policy?.actions.find((a) => a.action === action) ?? null
  const selectedUser = users.find((u) => u.id === userId) ?? null

  const handleCreateSessionAndChallenge = async () => {
    if (!tenantId || !userId || !action || !resourceRef.trim()) return
    setError(null)
    setVerifyResult(null)
    setBusyStep('Creating verification session & fresh challenge...')
    try {
      const created = await api.createSession({
        tenant_id: tenantId,
        user_id: userId,
        requested_action: action,
        resource_reference: resourceRef.trim(),
        external_request_id: `WL-${Date.now().toString().slice(-6)}`,
        step_up_satisfied: stepUpSatisfied,
        request_context: { channel: 'voice_gateway_workbench' },
      })
      const ch = await api.issueChallenge(created.id)
      setSession(created)
      setChallenge(ch)
      recorder.clearRecording()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to initialize verification session')
    } finally {
      setBusyStep(null)
    }
  }

  const handleRegenerateChallenge = async () => {
    if (!session) return
    setError(null)
    setBusyStep('Generating fresh challenge phrase...')
    try {
      const ch = await api.issueChallenge(session.id)
      setChallenge(ch)
      recorder.clearRecording()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to refresh challenge')
    } finally {
      setBusyStep(null)
    }
  }

  const handleSubmitVerification = async () => {
    if (!session || !challenge || !recorder.recording) return
    setError(null)
    setBusyStep(
      'Submitting audio: validating file, transcribing challenge (faster-whisper), calling Aletheia & Eidos, and evaluating policy...',
    )
    try {
      const fd = new FormData()
      fd.append('challenge_id', challenge.id)
      fd.append('file', recorder.recording.file)
      const res = await api.verifySessionAudio(session.id, fd)
      setVerifyResult(res)
      setSession(res.session)
      if (res.session.latest_challenge) setChallenge(res.session.latest_challenge)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Verification submission failed')
    } finally {
      setBusyStep(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Verification Workbench</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Operator test bench: request binding, fresh challenge, audio capture, Aletheia/Eidos verification, and token issuance.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-2.5 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Request Setup & Challenge/Audio */}
        <div className="lg:col-span-7 space-y-5">
          <section className="vl-surface rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-950">
              Steps 1–4 · Request &amp; Context Binding
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="wb-tenant" className="block text-xs font-medium text-zinc-700 mb-1">
                  1. Tenant
                </label>
                <select
                  id="wb-tenant"
                  value={tenantId}
                  onChange={(e) => {
                    setTenantId(e.target.value)
                    setSelectedTenantId(e.target.value)
                  }}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.industry})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wb-user" className="block text-xs font-medium text-zinc-700 mb-1">
                  2. User / Caller Identity Claim
                </label>
                <select
                  id="wb-user"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} [{u.role}] — {u.enrollment_status ?? 'not_enrolled'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wb-action" className="block text-xs font-medium text-zinc-700 mb-1">
                  3. Protected Operation
                </label>
                <select
                  id="wb-action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  {policy?.actions.map((a) => (
                    <option key={a.action} value={a.action}>
                      {a.label} ({a.risk_level})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wb-resource" className="block text-xs font-medium text-zinc-700 mb-1">
                  4. Resource Reference
                </label>
                <input
                  id="wb-resource"
                  type="text"
                  value={resourceRef}
                  onChange={(e) => setResourceRef(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            {selectedActionPolicy && (
              <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-3.5 text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900">{selectedActionPolicy.description}</span>
                  <RiskBadge risk={selectedActionPolicy.risk_level} />
                </div>
                <div className="flex flex-wrap gap-1.5 text-zinc-600 items-center">
                  <span>Checks:</span>
                  {selectedActionPolicy.require_challenge && (
                    <span className="font-mono bg-white border border-zinc-200 px-2 py-0.5 rounded-full text-[11px]">
                      Challenge STT
                    </span>
                  )}
                  {selectedActionPolicy.require_aletheia && (
                    <span className="font-mono bg-white border border-zinc-200 px-2 py-0.5 rounded-full text-[11px]">
                      Detectif Aletheia
                    </span>
                  )}
                  {selectedActionPolicy.require_eidos && (
                    <span className="font-mono bg-white border border-zinc-200 px-2 py-0.5 rounded-full text-[11px]">
                      Detectif Eidos
                    </span>
                  )}
                  <span className="font-mono bg-white border border-zinc-200 px-2 py-0.5 rounded-full text-[11px] vl-nums">
                    Token TTL: {selectedActionPolicy.token_ttl_seconds}s
                  </span>
                </div>
                {selectedUser && selectedActionPolicy.require_eidos && selectedUser.enrollment_status !== 'enrolled' && (
                  <p className="text-amber-700 font-medium">
                    Note: {selectedUser.name} does not have an active Eidos voice enrollment. Submitting
                    will trigger {selectedActionPolicy.missing_enrollment_outcome} per policy.{' '}
                    <Link to="/security/enrollment" className="underline">Enroll now</Link>.
                  </p>
                )}
              </div>
            )}

            {selectedActionPolicy?.always_require_step_up && (
              <label className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                <input
                  type="checkbox"
                  checked={stepUpSatisfied}
                  onChange={(e) => setStepUpSatisfied(e.target.checked)}
                  className="rounded border-zinc-300 text-zinc-950"
                />
                <span>Secondary out-of-band step-up confirmation satisfied</span>
              </label>
            )}

            <button
              type="button"
              disabled={Boolean(busyStep) || !userId || !action}
              onClick={() => void handleCreateSessionAndChallenge()}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4 text-zinc-300" aria-hidden="true" />
              <span>Create Session &amp; Issue Fresh Challenge</span>
            </button>
          </section>

          {session && challenge && (
            <section className="vl-surface rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-950">
                  Steps 5–8 · Fresh Challenge &amp; Voice Submission
                </h2>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 font-mono text-zinc-800 vl-nums">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {challenge.status === 'CONSUMED'
                      ? 'Consumed'
                      : secondsLeft > 0
                        ? `${secondsLeft}s remaining`
                        : 'Expired'}
                  </span>
                  {!verifyResult && (
                    <button
                      type="button"
                      disabled={Boolean(busyStep)}
                      onClick={() => void handleRegenerateChallenge()}
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-950"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>New Phrase</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-zinc-950 border border-zinc-800 text-white p-5 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                  Caller Must Speak Exact Challenge Phrase
                </div>
                <div className="text-lg sm:text-xl font-medium tracking-tight">
                  &ldquo;{challenge.challenge_text}&rdquo;
                </div>
                <div className="text-[11px] font-mono text-zinc-400">
                  Session {session.id.slice(0, 8)} · {session.requested_action} · {session.resource_reference}
                </div>
              </div>

              {!verifyResult && (
                <>
                  <AudioRecorderPanel
                    title="Record or Upload Caller Response"
                    minDurationSeconds={selectedActionPolicy?.require_eidos ? 3 : 2}
                    maxDurationSeconds={selectedActionPolicy?.require_eidos ? 60 : 300}
                    recommendedSeconds={10}
                    isRecording={recorder.isRecording}
                    elapsedSeconds={recorder.elapsedSeconds}
                    audioLevel={recorder.audioLevel}
                    recording={recorder.recording}
                    recorderError={recorder.recorderError}
                    onStart={() => void recorder.startRecording()}
                    onStop={recorder.stopRecording}
                    onRetake={recorder.clearRecording}
                    onUploadFile={(f) => void recorder.setUploadedFile(f)}
                    disabled={Boolean(busyStep)}
                  />

                  <button
                    type="button"
                    disabled={!recorder.recording || recorder.isRecording || Boolean(busyStep)}
                    onClick={() => void handleSubmitVerification()}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <span>{busyStep ?? 'Submit Audio to VoiceLock Gateway'}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </section>
          )}
        </div>

        {/* Right: Steps 9-10 Verification Results */}
        <div className="lg:col-span-5 space-y-5">
          <section className="vl-surface rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-950">
              Steps 9–10 · Evaluation &amp; Authorization Decision
            </h2>

            {busyStep && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 space-y-1">
                <div className="font-semibold">Processing Verification Pipeline...</div>
                <p className="text-xs text-zinc-600">{busyStep}</p>
              </div>
            )}

            {!busyStep && !verifyResult && (
              <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
                Create a session, submit the spoken challenge audio, and inspect real model results and token issuance here.
              </div>
            )}

            {verifyResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div>
                    <div className="text-xs text-zinc-500">Policy Outcome</div>
                    <div className="mt-1">
                      <OutcomeBadge outcome={verifyResult.decision.outcome} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-zinc-500">Policy Version</div>
                    <div className="text-xs font-mono font-semibold text-zinc-800 mt-1">
                      {verifyResult.decision.policy_id} v{verifyResult.decision.policy_version}
                    </div>
                  </div>
                </div>

                <p className="text-sm text-zinc-700 leading-relaxed">{verifyResult.decision.explanation}</p>

                <div className="flex flex-wrap gap-1.5">
                  {verifyResult.decision.reason_codes.map((code) => (
                    <span
                      key={code}
                      className="rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 text-[11px] font-mono text-zinc-700"
                    >
                      {code}
                    </span>
                  ))}
                </div>

                <div className="space-y-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Individual Check Signals
                  </div>
                  {verifyResult.session.verification_results.map((r) => {
                    const ok = ['MATCH', 'REAL'].includes(r.normalized_result)
                    return (
                      <div key={r.id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-950">
                            {ok ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-rose-600" />
                            )}
                            <span className="capitalize">{r.check_type.replaceAll('_', ' ')}</span>
                          </div>
                          <ProvenanceBadge mode={r.provider_mode} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-zinc-600">
                          <span>Result: <strong className="text-zinc-950">{r.normalized_result}</strong></span>
                          {r.score_or_similarity !== null && (
                            <span className="font-mono vl-nums">
                              {r.check_type === 'speaker_verification'
                                ? `Similarity: ${r.score_or_similarity.toFixed(3)} (-1..1)`
                                : r.check_type === 'voice_authenticity'
                                  ? `Score: ${r.score_or_similarity.toFixed(3)} (0..1)`
                                  : `Match: ${Math.round(r.score_or_similarity * 100)}%`}
                            </span>
                          )}
                        </div>
                        {typeof r.details_json?.transcript === 'string' && (
                          <div className="text-[11px] text-zinc-500">
                            Transcript: &ldquo;{r.details_json.transcript}&rdquo;
                          </div>
                        )}
                        {r.error_message && (
                          <div className="text-[11px] text-rose-600">{r.error_code}: {r.error_message}</div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {verifyResult.authorization_token && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-900">
                        Single-Use Action-Bound Token Issued
                      </span>
                      <CopyButton text={verifyResult.authorization_token} label="Copy authorization token" />
                    </div>
                    <div className="font-mono text-xs break-all bg-white border border-emerald-200 rounded-lg p-2 text-zinc-800">
                      {verifyResult.authorization_token}
                    </div>
                    <div className="text-[11px] text-emerald-800">
                      Bound strictly to action <code>{verifyResult.session.requested_action}</code> &amp;
                      resource <code>{verifyResult.session.resource_reference}</code>.
                    </div>
                  </div>
                )}

                <div className="pt-2 flex items-center justify-between">
                  <Link
                    to={`/security/decisions/${verifyResult.session.id}`}
                    className="text-xs font-medium text-zinc-700 hover:text-zinc-950"
                  >
                    Open Decision &amp; Audit &rarr;
                  </Link>
                  <Link
                    to="/security/workflows"
                    className="text-xs font-medium text-zinc-700 hover:text-zinc-950"
                  >
                    Test in Workflow &rarr;
                  </Link>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
