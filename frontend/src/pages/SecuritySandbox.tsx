import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FlaskConical,
  History,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Swords,
  XCircle,
} from 'lucide-react'
import { api, ApiClientError } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { VoiceChallengeCard } from '../components/voicelock/VoiceChallengeCard'
import { VoiceRecorder } from '../components/voicelock/VoiceRecorder'
import { VerificationProgress, type VerificationStageItem } from '../components/voicelock/VerificationProgress'
import { VerificationResult } from '../components/voicelock/VerificationResult'
import { SandboxAnalyticsPanel } from '../components/sandbox/SandboxAnalyticsPanel'
import type {
  SandboxAnalytics,
  SandboxEnvironment,
  SandboxOverview,
  SandboxSessionItem,
  SandboxVerifyResponse,
} from '../types'

type SandboxTab = 'overview' | 'verify' | 'attack_lab' | 'history' | 'analytics'

const ATTACK_TESTS = [
  {
    id: 'genuine_speaker',
    title: 'Genuine Speaker',
    inputType: 'microphone',
    description: 'Enrolled speaker records the fresh challenge phrase. Real Aletheia + Eidos + STT checks execute.',
  },
  {
    id: 'different_speaker',
    title: 'Different Speaker Attack',
    inputType: 'microphone',
    description: 'A different person attempts verification. Eidos evaluates speaker identity against the enrolled profile.',
  },
  {
    id: 'synthetic_voice',
    title: 'AI-Generated Voice Attack',
    inputType: 'upload',
    description: 'Upload a permitted synthetic or cloned voice sample. Aletheia evaluates voice authenticity.',
  },
  {
    id: 'replay_attack',
    title: 'Replay Attack (Consumed Challenge)',
    inputType: 'upload',
    description: 'Resubmits audio against an already-consumed challenge ID to test server-side replay protection.',
  },
  {
    id: 'incorrect_challenge',
    title: 'Incorrect Challenge Phrase',
    inputType: 'microphone',
    description: 'Speak a different sentence from the displayed challenge phrase. STT + PolicyEngine evaluate mismatch.',
  },
  {
    id: 'poor_audio_quality',
    title: 'Poor Audio Quality / Corrupt Input',
    inputType: 'upload',
    description: 'Submit short, silent, noisy, corrupted, or unsupported audio files to verify safe rejection.',
  },
] as const

function DecisionPill({ outcome }: { outcome: string | null }) {
  if (!outcome) {
    return <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600">PENDING</span>
  }
  const styles: Record<string, string> = {
    APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
    REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
    STEP_UP: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[outcome] || 'bg-zinc-100 text-zinc-700 border-zinc-200'}`}>
      {outcome}
    </span>
  )
}

export function SecuritySandbox() {
  const { selectedTenantId } = useAuth()
  const [activeTab, setActiveTab] = useState<SandboxTab>('overview')
  const [overview, setOverview] = useState<SandboxOverview | null>(null)
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([])
  const [analytics, setAnalytics] = useState<SandboxAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Active simulation state
  const [selectedEnv, setSelectedEnv] = useState<SandboxEnvironment | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedAttackType, setSelectedAttackType] = useState<string>('genuine_speaker')
  const [activeSession, setActiveSession] = useState<SandboxSessionItem | null>(null)
  const [verifyResult, setVerifyResult] = useState<SandboxVerifyResponse | null>(null)
  const [lastConsumedChallengeId, setLastConsumedChallengeId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [stages, setStages] = useState<VerificationStageItem[]>([])

  // History filters
  const [historyItems, setHistoryItems] = useState<SandboxSessionItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [searchQ, setSearchQ] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [filterDecision, setFilterDecision] = useState('')
  const [pageOffset, setPageOffset] = useState(0)
  const [inspectedSession, setInspectedSession] = useState<SandboxSessionItem | null>(null)

  const recorder = useAudioRecorder()

  const loadCoreData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ov, envs, an] = await Promise.all([
        api.sandboxOverview(selectedTenantId || undefined),
        api.sandboxEnvironments(),
        api.sandboxAnalytics(),
      ])
      setOverview(ov)
      setEnvironments(envs)
      setAnalytics(an)
      if (!selectedEnv && envs.length > 0) {
        setSelectedEnv(envs[0])
        if (envs[0].users.length > 0) setSelectedUserId(envs[0].users[0].id)
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load Security Sandbox.')
    } finally {
      setLoading(false)
    }
  }, [selectedTenantId, selectedEnv])

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.sandboxSessions({
        q: searchQ || undefined,
        industry: filterIndustry || undefined,
        decision: filterDecision || undefined,
        limit: 10,
        offset: pageOffset,
      })
      setHistoryItems(res.items)
      setHistoryTotal(res.total)
    } catch {
      // ignore transient filter errors
    }
  }, [searchQ, filterIndustry, filterDecision, pageOffset])

  useEffect(() => {
    void loadCoreData()
  }, [loadCoreData])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const ch = activeSession?.verification_session?.latest_challenge
    if (!ch) {
      setSecondsLeft(0)
      return
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(ch.expires_at).getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [activeSession])

  const startSimulation = async (env: SandboxEnvironment, attackType = 'genuine_speaker', goToTab: SandboxTab = 'verify') => {
    setError(null)
    setVerifyResult(null)
    recorder.clearRecording()
    setSelectedEnv(env)
    setSelectedAttackType(attackType)
    const uid = selectedUserId && env.users.some((u) => u.id === selectedUserId)
      ? selectedUserId
      : env.users[0]?.id
    if (uid) setSelectedUserId(uid)

    try {
      const created = await api.createSandboxSession({
        industry: env.industry,
        scenario_id: env.scenario_id,
        tenant_id: env.tenant_id || undefined,
        user_id: uid,
        requested_action: env.requested_action,
        attack_type: attackType,
        input_type: attackType === 'synthetic_voice' || attackType === 'poor_audio_quality' ? 'upload' : 'microphone',
      })
      setActiveSession(created)
      setStages([
        { id: 'upload', label: 'Voice recording received', state: 'waiting' },
        { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'waiting' },
        { id: 'eidos', label: 'Matching enrolled speaker — Eidos', state: 'waiting' },
        { id: 'phrase', label: 'Validating fresh challenge phrase', state: 'waiting' },
        { id: 'policy', label: 'Evaluating backend policy engine', state: 'waiting' },
        { id: 'decision', label: 'Finalizing decision & audit event', state: 'waiting' },
      ])
      setActiveTab(goToTab)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to start sandbox session.')
    }
  }

  const handleSandboxVerify = async () => {
    if (!activeSession || !recorder.recording) return
    const currentChallenge = activeSession.verification_session?.latest_challenge
    if (!currentChallenge) return

    setError(null)
    setSubmitting(true)
    setStages([
      { id: 'upload', label: 'Voice recording received', state: 'processing' },
      { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'processing' },
      { id: 'eidos', label: 'Matching enrolled speaker — Eidos', state: 'processing' },
      { id: 'phrase', label: 'Validating fresh challenge phrase', state: 'processing' },
      { id: 'policy', label: 'Evaluating backend policy engine', state: 'waiting' },
      { id: 'decision', label: 'Finalizing decision & audit event', state: 'waiting' },
    ])

    try {
      const fd = new FormData()
      const challengeToUse =
        selectedAttackType === 'replay_attack' && lastConsumedChallengeId
          ? lastConsumedChallengeId
          : currentChallenge.id
      fd.append('challenge_id', challengeToUse)
      fd.append('attack_type', selectedAttackType)
      fd.append('input_type', recorder.recording.file.name.startsWith('recording-') ? 'microphone' : 'upload')
      fd.append('file', recorder.recording.file)

      const res = await api.verifySandboxSession(activeSession.id, fd)
      setLastConsumedChallengeId(currentChallenge.id)
      setActiveSession(res.sandbox_session)
      setVerifyResult(res)

      const outcome = res.verification.decision.outcome
      setStages([
        { id: 'upload', label: 'Voice recording received', state: 'completed' },
        { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'completed', detail: res.sandbox_session.aletheia_summary || undefined },
        { id: 'eidos', label: 'Matching enrolled speaker — Eidos', state: 'completed', detail: res.sandbox_session.eidos_summary || undefined },
        { id: 'phrase', label: 'Validating fresh challenge phrase', state: res.sandbox_session.challenge_valid === false ? 'failed' : 'completed' },
        { id: 'policy', label: 'Evaluating backend policy engine', state: 'completed' },
        {
          id: 'decision',
          label: 'Finalizing decision & audit event',
          state: outcome === 'PASS' ? 'completed' : outcome === 'REJECT' ? 'failed' : 'review',
          detail: `Decision: ${res.sandbox_session.decision_outcome}`,
        },
      ])
      void loadCoreData()
      void loadHistory()
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Verification failed.'
      setError(msg)
      setStages((prev) => prev.map((s) => (s.id === 'upload' ? { ...s, state: 'failed', detail: msg } : s)))
      void loadCoreData()
      void loadHistory()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 mb-2">
            <FlaskConical className="h-3.5 w-3.5 text-zinc-900" />
            <span>Controlled Security Testing Console</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Security Sandbox</h1>
          <p className="text-sm text-zinc-600 mt-1 max-w-2xl">
            Test the real VoiceSuraksha-Sync pipeline (fresh challenge, Detectif.ai Aletheia, Detectif.ai Eidos,
            deterministic Policy Engine, and n8n automation) across four industry environments without touching live systems.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadCoreData()}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-200 pb-2">
        {[
          { id: 'overview', label: 'Sandbox Overview', icon: Activity },
          { id: 'verify', label: 'Voice Verification Sandbox', icon: ShieldCheck },
          { id: 'attack_lab', label: 'Attack Simulation Lab', icon: Swords },
          { id: 'history', label: 'Session History', icon: History },
          { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as SandboxTab)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === id
                ? 'bg-zinc-950 text-white'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: OVERVIEW & INDUSTRY SELECTION */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Real DB Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="vl-surface rounded-2xl p-4">
              <div className="text-xs font-medium text-zinc-500">Total Tests Executed</div>
              <div className="text-2xl font-semibold text-zinc-950 mt-1 vl-nums">{overview?.total_tests ?? 0}</div>
            </div>
            <div className="vl-surface rounded-2xl p-4">
              <div className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Approved
              </div>
              <div className="text-2xl font-semibold text-zinc-950 mt-1 vl-nums">{overview?.approved_attempts ?? 0}</div>
            </div>
            <div className="vl-surface rounded-2xl p-4">
              <div className="text-xs font-medium text-rose-700 flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Rejected
              </div>
              <div className="text-2xl font-semibold text-zinc-950 mt-1 vl-nums">{overview?.rejected_attempts ?? 0}</div>
            </div>
            <div className="vl-surface rounded-2xl p-4">
              <div className="text-xs font-medium text-amber-700 flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> Review Required
              </div>
              <div className="text-2xl font-semibold text-zinc-950 mt-1 vl-nums">
                {(overview?.review_attempts ?? 0) + (overview?.step_up_attempts ?? 0)}
              </div>
            </div>
          </div>

          {/* 4 Industry Simulation Environments */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 mb-3">Industry Simulation Environments</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {environments.map((env) => (
                <div key={env.scenario_id} className="vl-surface-interactive rounded-2xl p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{env.industry_name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        env.sensitivity_level === 'CRITICAL'
                          ? 'bg-rose-100 text-rose-800'
                          : env.sensitivity_level === 'HIGH'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-zinc-100 text-zinc-700'
                      }`}>
                        {env.sensitivity_level} SENSITIVITY
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-zinc-950">{env.scenario_name}</h3>
                    <p className="text-xs text-zinc-600">{env.short_description}</p>
                    <div className="rounded-lg bg-zinc-50 border border-zinc-200/70 px-3 py-2 text-xs text-zinc-700">
                      <span className="font-medium text-zinc-900">Attempted Operation:</span> {env.attempt_summary}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-100">
                    <span className="text-[11px] text-zinc-500">
                      {env.users.length} test user{env.users.length === 1 ? '' : 's'} available
                    </span>
                    <button
                      type="button"
                      onClick={() => void startSimulation(env, 'genuine_speaker', 'verify')}
                      className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                    >
                      <Play className="h-3 w-3" />
                      <span>Start Simulation</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Sessions & Latest Incidents */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="vl-surface rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-zinc-950">Recent Sandbox Sessions</h3>
              {!overview || overview.recent_sessions.length === 0 ? (
                <p className="text-xs text-zinc-500 py-6 text-center">No sandbox sessions recorded yet. Start a simulation above.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {overview.recent_sessions.map((s) => (
                    <li key={s.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-900 truncate">{s.scenario_title}</div>
                        <div className="text-zinc-500 truncate">{s.industry.toUpperCase()} · {s.user_name} · {s.attack_type}</div>
                      </div>
                      <DecisionPill outcome={s.decision_outcome} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="vl-surface rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-zinc-950">Latest Security Incidents</h3>
              {!overview || overview.latest_incidents.length === 0 ? (
                <p className="text-xs text-zinc-500 py-6 text-center">No rejected or review-required sandbox incidents yet.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {overview.latest_incidents.map((s) => (
                    <li key={s.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-900 truncate">{s.requested_action} ({s.industry})</div>
                        <div className="text-rose-600 truncate">{s.failure_reason || 'Flagged by policy engine'}</div>
                      </div>
                      <DecisionPill outcome={s.decision_outcome} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2 & 3: VOICE VERIFICATION SANDBOX & ATTACK LAB */}
      {(activeTab === 'verify' || activeTab === 'attack_lab') && (
        <div className="space-y-5">
          {activeTab === 'attack_lab' && (
            <div className="vl-surface rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-950">Attack Simulation Lab</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Select an attack or quality scenario below. Every test runs through the real FastAPI verification pipeline.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {ATTACK_TESTS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      const env = selectedEnv || environments[0]
                      if (env) void startSimulation(env, t.id, 'attack_lab')
                    }}
                    className={`text-left rounded-xl border p-3.5 transition-colors ${
                      selectedAttackType === t.id
                        ? 'border-zinc-950 bg-zinc-50'
                        : 'border-zinc-200 hover:border-zinc-400 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-950">{t.title}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600">{t.inputType}</span>
                    </div>
                    <p className="text-[11px] text-zinc-600 mt-1.5">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scenario & User Controls */}
          <div className="vl-surface rounded-2xl p-5 flex flex-wrap items-end gap-4">
            <div className="min-w-[180px] flex-1">
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Industry Environment</label>
              <select
                value={selectedEnv?.scenario_id || ''}
                onChange={(e) => {
                  const found = environments.find((env) => env.scenario_id === e.target.value)
                  if (found) void startSimulation(found, selectedAttackType, activeTab)
                }}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
              >
                {environments.map((env) => (
                  <option key={env.scenario_id} value={env.scenario_id}>
                    {env.industry_name} — {env.scenario_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[180px] flex-1">
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Target Test User</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
              >
                {(selectedEnv?.users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role}) {u.enrolled ? '· Enrolled' : '· Not Enrolled'}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                const env = selectedEnv || environments[0]
                if (env) void startSimulation(env, selectedAttackType, activeTab)
              }}
              className="rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
            >
              New Sandbox Session
            </button>
          </div>

          {!activeSession ? (
            <div className="vl-surface rounded-2xl p-10 text-center text-sm text-zinc-500">
              Click <strong>New Sandbox Session</strong> or choose an industry card to begin.
            </div>
          ) : (
            <div className="vl-surface rounded-2xl p-5 sm:p-6 space-y-5">
              {/* Session Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-zinc-200/70 bg-zinc-50/70 p-3.5 text-xs">
                <div>
                  <div className="text-[11px] text-zinc-500">Sandbox Session</div>
                  <div className="font-mono font-semibold text-zinc-950 truncate">{activeSession.id.slice(0, 12)}...</div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">Industry & Operation</div>
                  <div className="font-semibold text-zinc-950">{activeSession.industry.toUpperCase()} · {activeSession.requested_action}</div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">Reference ID</div>
                  <div className="font-mono font-semibold text-zinc-950">{activeSession.resource_reference}</div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500">Test Mode</div>
                  <div className="font-semibold text-zinc-950">{selectedAttackType.replace(/_/g, ' ')}</div>
                </div>
              </div>

              {activeSession.verification_session?.latest_challenge && !verifyResult && (
                <VoiceChallengeCard
                  challenge={activeSession.verification_session.latest_challenge}
                  secondsLeft={secondsLeft}
                  disabled={submitting}
                  onRefresh={() => {
                    const env = selectedEnv || environments[0]
                    if (env) void startSimulation(env, selectedAttackType, activeTab)
                  }}
                />
              )}

              {!verifyResult && (
                <VoiceRecorder
                  minDurationSeconds={selectedAttackType === 'poor_audio_quality' ? 0 : 3}
                  maxDurationSeconds={60}
                  isRecording={recorder.isRecording}
                  elapsedSeconds={recorder.elapsedSeconds}
                  audioLevel={recorder.audioLevel}
                  recording={recorder.recording}
                  recorderError={recorder.recorderError}
                  onStart={() => void recorder.startRecording()}
                  onStop={recorder.stopRecording}
                  onRetake={recorder.clearRecording}
                  onUploadFile={(f) => void recorder.setUploadedFile(f)}
                  onSubmit={() => void handleSandboxVerify()}
                  submitting={submitting}
                  disabled={false}
                />
              )}

              {(submitting || verifyResult) && <VerificationProgress stages={stages} />}

              {verifyResult && (
                <div className="space-y-4">
                  <VerificationResult
                    response={verifyResult.verification}
                    actionLabel={activeSession.scenario_title}
                    maskedAccountDisplay={activeSession.resource_reference}
                    attackSimulationMode={activeTab === 'attack_lab'}
                    onRetryVerification={() => {
                      const env = selectedEnv || environments[0]
                      if (env) void startSimulation(env, selectedAttackType, activeTab)
                    }}
                  />
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <span className="text-zinc-500">Aletheia Summary:</span>{' '}
                      <strong className="text-zinc-900">{verifyResult.sandbox_session.aletheia_summary || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Eidos Summary:</span>{' '}
                      <strong className="text-zinc-900">{verifyResult.sandbox_session.eidos_summary || 'N/A'}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Audit Event Ref:</span>{' '}
                      <strong className="font-mono text-zinc-900">{verifyResult.sandbox_session.audit_event_id?.slice(0, 12) || 'Recorded'}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SESSION HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="vl-surface rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value)
                  setPageOffset(0)
                }}
                placeholder="Search session, user, action, reference..."
                className="w-full rounded-lg border border-zinc-200 pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
            <select
              value={filterIndustry}
              onChange={(e) => {
                setFilterIndustry(e.target.value)
                setPageOffset(0)
              }}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs"
            >
              <option value="">All Industries</option>
              <option value="telecom">Telecom</option>
              <option value="banking">Banking</option>
              <option value="helpdesk">IT Helpdesk</option>
              <option value="education">Education</option>
            </select>
            <select
              value={filterDecision}
              onChange={(e) => {
                setFilterDecision(e.target.value)
                setPageOffset(0)
              }}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs"
            >
              <option value="">All Decisions</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="REVIEW">REVIEW</option>
              <option value="STEP_UP">STEP_UP</option>
            </select>
          </div>

          <div className="vl-surface rounded-2xl overflow-hidden">
            {historyItems.length === 0 ? (
              <div className="p-10 text-center text-xs text-zinc-500">No matching sandbox sessions found.</div>
            ) : (
              <div className="vl-table-wrapper">
                <table className="w-full text-left text-xs vl-responsive-table">
                  <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                    <tr>
                      <th className="px-4 py-3 font-medium">Scenario</th>
                      <th className="px-4 py-3 font-medium">Industry</th>
                      <th className="px-4 py-3 font-medium">Test Type</th>
                      <th className="px-4 py-3 font-medium">Aletheia / Eidos</th>
                      <th className="px-4 py-3 font-medium">Decision</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {historyItems.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setInspectedSession(item)}
                        className="hover:bg-zinc-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 font-medium text-zinc-900" data-label="Scenario">
                          {item.scenario_title}
                          <div className="text-[11px] text-zinc-500 font-normal">{item.user_name}</div>
                        </td>
                        <td className="px-4 py-3 uppercase text-zinc-700" data-label="Industry">{item.industry}</td>
                        <td className="px-4 py-3 text-zinc-600" data-label="Test Type">{item.attack_type}</td>
                        <td className="px-4 py-3 text-zinc-600" data-label="Models">
                          {item.aletheia_summary || '—'} / {item.eidos_summary || '—'}
                        </td>
                        <td className="px-4 py-3" data-label="Decision"><DecisionPill outcome={item.decision_outcome} /></td>
                        <td className="px-4 py-3 text-zinc-500 vl-nums" data-label="Created">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-500">
              <span>Showing {historyItems.length} of {historyTotal} sessions</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pageOffset === 0}
                  onClick={() => setPageOffset(Math.max(0, pageOffset - 10))}
                  className="rounded border border-zinc-200 px-2.5 py-1 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={pageOffset + 10 >= historyTotal}
                  onClick={() => setPageOffset(pageOffset + 10)}
                  className="rounded border border-zinc-200 px-2.5 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {inspectedSession && (
            <div className="vl-surface rounded-2xl p-5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-950">Session Details — {inspectedSession.id}</h3>
                <button type="button" onClick={() => setInspectedSession(null)} className="text-zinc-500 hover:text-zinc-900">Close</button>
              </div>
              <p className="text-zinc-600">Action: <strong>{inspectedSession.requested_action}</strong> · Resource: <strong>{inspectedSession.resource_reference}</strong></p>
              <p className="text-zinc-600">Audit Event ID: <span className="font-mono">{inspectedSession.audit_event_id || 'N/A'}</span></p>
              {inspectedSession.failure_reason && (
                <p className="text-rose-700">Reason: {inspectedSession.failure_reason}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: ANALYTICS */}
      {activeTab === 'analytics' && <SandboxAnalyticsPanel analytics={analytics} loading={loading} />}
    </div>
  )
}
