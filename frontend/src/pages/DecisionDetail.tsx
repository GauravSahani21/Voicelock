import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  KeyRound,
  ScrollText,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react'
import { useLivePolling } from '../hooks/useLivePolling'
import { api, ApiClientError } from '../services/api'
import { IndustryBadge, OutcomeBadge, ProvenanceBadge } from '../components/ui/Badges'
import { CopyButton } from '../components/ui/CopyButton'
import type { AuditEventItem, SessionDetail } from '../types'

export function DecisionDetail() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [reviewNote, setReviewNote] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [issuedOverrideToken, setIssuedOverrideToken] = useState<string | null>(null)

  const loadDetail = useCallback(
    async (silent = false) => {
      if (!id) return
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        const sess = await api.getSession(id).catch(() => api.getDecision(id))
        setSession(sess)
        const events = await api.listAuditEvents({ session_id: sess.id })
        setAuditEvents([...events].reverse())
        setError(null)
      } catch (err: unknown) {
        if (!silent) {
          setError(err instanceof ApiClientError ? err.message : 'Unable to load decision detail')
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [id],
  )

  useEffect(() => {
    void loadDetail(false)
  }, [loadDetail])

  useLivePolling(
    () => {
      void loadDetail(true)
    },
    { intervalMs: 5000, enabled: Boolean(id) },
  )

  const handleReviewSubmit = async (resolution: 'APPROVE' | 'REJECT') => {
    if (!session?.decision || reviewNote.trim().length < 4) return
    setReviewBusy(true)
    setError(null)
    try {
      const res = await api.submitHumanReview(session.decision.id, resolution, reviewNote.trim())
      setSession(res.session)
      if (res.authorization_token) {
        setIssuedOverrideToken(res.authorization_token)
      }
      const events = await api.listAuditEvents({ session_id: session.id })
      setAuditEvents([...events].reverse())
      setReviewNote('')
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Review action failed')
    } finally {
      setReviewBusy(false)
    }
  }

  if (loading) {
    return <div className="p-10 text-center text-sm text-zinc-500">Loading decision record...</div>
  }

  if (error || !session) {
    return (
      <div className="space-y-4">
        <Link to="/security/requests" className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-950">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Verification Requests
        </Link>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error ?? 'Session not found'}
        </div>
      </div>
    )
  }

  const resolvedOutcome =
    session.status === 'HUMAN_APPROVED'
      ? 'PASS'
      : session.status === 'HUMAN_REJECTED'
        ? 'REJECT'
        : (session.decision?.outcome ?? session.status)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Link to="/security/requests" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-950">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All Verification Requests
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-950">
              Decision Detail · <span className="font-mono">{session.requested_action}</span>
            </h1>
            <OutcomeBadge outcome={resolvedOutcome} />
            <ProvenanceBadge mode={session.source_mode} />
          </div>
          <p className="text-xs font-mono text-zinc-500 vl-nums">
            Session {session.id} · Created {new Date(session.created_at).toLocaleString()}
          </p>
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadDetail(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Request Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <InfoCard label="Tenant & Industry" value={session.tenant_name} extra={<IndustryBadge industry={session.industry} />} />
        <InfoCard label="User / Role" value={session.user_name} sub={`${session.user_external_reference} · role: ${session.user_role}`} />
        <InfoCard label="Action & Resource" value={session.requested_action} sub={`Resource: ${session.resource_reference}`} mono />
        <InfoCard
          label="Policy & Token Status"
          value={`${session.policy_id} v${session.policy_version}`}
          sub={
            session.token_summary
              ? `Token: ${session.token_summary.status} (exp ${new Date(session.token_summary.expires_at).toLocaleTimeString()})`
              : 'No authorization token issued'
          }
        />
      </div>

      {/* Security Event Lifecycle */}
      <section className="vl-surface rounded-2xl p-5 sm:p-6 space-y-3.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Security Event Lifecycle</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-9 gap-2 text-[11px]">
          {buildLifecycleSteps(session).map((step) => (
            <div
              key={step.label}
              className={`rounded-xl border p-2.5 ${
                step.status === 'done'
                  ? 'border-emerald-200/80 bg-emerald-50/70 text-emerald-950'
                  : step.status === 'blocked'
                    ? 'border-rose-200/80 bg-rose-50/70 text-rose-950'
                    : step.status === 'hold'
                      ? 'border-amber-200/80 bg-amber-50/70 text-amber-950'
                      : 'border-zinc-200/70 bg-zinc-50 text-zinc-500'
              }`}
            >
              <div className="font-semibold leading-tight">{step.label}</div>
              <div className="mt-1 font-mono uppercase text-[10px] opacity-80">{step.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Policy Decision & Explanation */}
      {session.decision && (
        <section className="vl-surface rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-950">Policy Decision &amp; Reason Codes</h2>
            <OutcomeBadge outcome={resolvedOutcome} />
          </div>
          <p className="text-sm text-zinc-700 leading-relaxed">{session.decision.explanation}</p>
          <div className="flex flex-wrap gap-1.5">
            {session.decision.reason_codes.map((rc) => (
              <span key={rc} className="rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 text-xs font-mono text-zinc-800">
                {rc}
              </span>
            ))}
          </div>
          {session.decision.triggered_rules.length > 0 && (
            <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Triggered Policy Rules
              </div>
              <ul className="space-y-1 text-xs font-mono text-zinc-700">
                {session.decision.triggered_rules.map((rule, i) => (
                  <li key={i}>• {rule}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Human Review Resolution */}
      {session.decision && (session.decision.outcome === 'REVIEW' || session.decision.outcome === 'STEP_UP') && session.status !== 'HUMAN_APPROVED' && session.status !== 'HUMAN_REJECTED' && (
        <section className="bg-amber-50/60 rounded-2xl border border-amber-200 p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
            <ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden="true" />
            <span>Operator Review Required ({session.decision.outcome})</span>
          </div>
          <p className="text-xs text-amber-900">
            After out-of-band customer/employee verification, record your review decision below.
          </p>
          <textarea
            rows={2}
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="Enter verification rationale (e.g. Verified employee via live video call)"
            className="w-full rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={reviewBusy || reviewNote.trim().length < 4}
              onClick={() => void handleReviewSubmit('APPROVE')}
              className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve &amp; Issue One-Time Token
            </button>
            <button
              type="button"
              disabled={reviewBusy || reviewNote.trim().length < 4}
              onClick={() => void handleReviewSubmit('REJECT')}
              className="rounded-full bg-rose-600 px-4 py-2 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Confirm Rejection
            </button>
          </div>
        </section>
      )}

      {issuedOverrideToken && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-900">Human-Reviewed One-Time Token Issued</span>
            <CopyButton text={issuedOverrideToken} label="Copy override token" />
          </div>
          <code className="block text-xs font-mono bg-white border border-emerald-200 rounded-lg p-2.5 break-all">
            {issuedOverrideToken}
          </code>
        </div>
      )}

      {/* Check Signals & Audit Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="vl-surface rounded-2xl p-6 space-y-3.5">
          <h2 className="text-sm font-semibold text-zinc-950">Model &amp; Challenge Evidence</h2>
          {session.latest_challenge && (
            <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-3.5 text-xs space-y-1">
              <div className="font-semibold text-zinc-900">
                Issued Challenge ({session.latest_challenge.status})
              </div>
              <div className="font-mono text-zinc-700">&ldquo;{session.latest_challenge.challenge_text}&rdquo;</div>
              <div className="text-[11px] text-zinc-500 vl-nums">
                Expires: {new Date(session.latest_challenge.expires_at).toLocaleString()}
                {session.latest_challenge.consumed_at
                  ? ` · Consumed: ${new Date(session.latest_challenge.consumed_at).toLocaleString()}`
                  : ''}
              </div>
            </div>
          )}

          {session.verification_results.map((r) => {
            const passed = ['MATCH', 'REAL'].includes(r.normalized_result)
            return (
              <div key={r.id} className="rounded-xl border border-zinc-200/80 p-4 space-y-1.5 bg-zinc-50/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-950">
                    {passed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-600" />
                    )}
                    <span className="capitalize">{r.check_type.replaceAll('_', ' ')}</span>
                    <span className="text-zinc-400">({r.provider})</span>
                  </div>
                  <ProvenanceBadge mode={r.provider_mode} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
                  <span>
                    Verdict: <strong className="text-zinc-950">{r.normalized_result}</strong>
                    {r.raw_verdict ? ` (raw: ${r.raw_verdict})` : ''}
                  </span>
                  {r.score_or_similarity !== null && (
                    <span className="font-mono vl-nums">
                      {r.check_type === 'speaker_verification'
                        ? `Similarity: ${r.score_or_similarity.toFixed(3)} [-1..1]`
                        : r.check_type === 'voice_authenticity'
                          ? `Synthetic Score: ${r.score_or_similarity.toFixed(3)} [0..1]`
                          : `Token Match: ${Math.round(r.score_or_similarity * 100)}%`}
                    </span>
                  )}
                </div>
                {r.provider_reference && (
                  <div className="text-[11px] font-mono text-zinc-500">
                    Op ID: {r.provider_reference}
                  </div>
                )}
                {typeof r.details_json?.transcript === 'string' && (
                  <div className="text-[11px] text-zinc-600">
                    Transcript: &ldquo;{r.details_json.transcript}&rdquo;
                  </div>
                )}
                {r.error_message && (
                  <div className="text-[11px] text-rose-600">
                    Error ({r.error_code}): {r.error_message}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <section className="vl-surface rounded-2xl p-6 space-y-4">
          {session.token_summary && (
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950">
                  <KeyRound className="h-3.5 w-3.5 text-zinc-700" aria-hidden="true" />
                  Authorization Token Metadata
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    session.token_summary.status === 'ACTIVE'
                      ? 'bg-emerald-100 text-emerald-800'
                      : session.token_summary.status === 'CONSUMED'
                        ? 'bg-zinc-200 text-zinc-800'
                        : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {session.token_summary.status}
                </span>
              </div>
              <div className="text-[11px] font-mono text-zinc-600">
                Action: {session.token_summary.action} · Resource: {session.token_summary.resource_reference}
              </div>
              <div className="text-[11px] text-zinc-500 vl-nums">
                Expires: {new Date(session.token_summary.expires_at).toLocaleString()}
                {session.token_summary.consumed_at
                  ? ` · Consumed: ${new Date(session.token_summary.consumed_at).toLocaleString()}`
                  : ''}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-950 mb-3">
              <ScrollText className="h-4 w-4 text-zinc-500" aria-hidden="true" />
              <span className="vl-nums">Session Audit Timeline ({auditEvents.length})</span>
            </div>
            <ol className="space-y-3 border-l border-zinc-200 pl-4">
              {auditEvents.map((ev) => (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-zinc-900 ring-2 ring-white" />
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-zinc-900">{ev.event_type}</span>
                    <span className="text-[11px] text-zinc-400 vl-nums">
                      {new Date(ev.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500">Actor: {ev.actor_reference}</div>
                  {Object.keys(ev.event_details).length > 0 && (
                    <pre className="mt-1 text-[11px] font-mono bg-zinc-50 border border-zinc-200/60 rounded-lg p-2 text-zinc-600 overflow-x-auto">
                      {JSON.stringify(ev.event_details)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  )
}

function InfoCard({
  label,
  value,
  sub,
  extra,
  mono = false,
}: {
  label: string
  value: string
  sub?: string
  extra?: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="vl-surface rounded-2xl p-4 space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-sm font-semibold text-zinc-950 ${mono ? 'font-mono' : ''} truncate`}>{value}</div>
      {extra && <div className="pt-0.5">{extra}</div>}
      {sub && <div className="text-xs text-zinc-500 truncate vl-nums">{sub}</div>}
    </div>
  )
}

function buildLifecycleSteps(session: SessionDetail) {
  const aletheia = session.verification_results.find((r) => r.check_type === 'voice_authenticity')
  const eidos = session.verification_results.find((r) => r.check_type === 'speaker_verification')
  const challenge = session.verification_results.find(
    (r) => r.check_type === 'challenge_phrase' || r.check_type === 'challenge_validation',
  )
  const outcome =
    session.status === 'HUMAN_APPROVED'
      ? 'PASS'
      : session.status === 'HUMAN_REJECTED'
        ? 'REJECT'
        : session.decision?.outcome
  const tok = session.token_summary
  const isClosed = session.status === 'CANCELLED' || session.status === 'EXPIRED'

  const checkTone = (res?: { normalized_result: string }) => {
    if (!res) {
      return isClosed
        ? { status: 'pending', detail: session.status }
        : session.verification_results.length > 0
          ? { status: 'done', detail: 'Skipped' }
          : { status: 'pending', detail: 'Waiting' }
    }
    if (['REAL', 'MATCH'].includes(res.normalized_result)) return { status: 'done', detail: res.normalized_result }
    if (['PROVIDER_ERROR', 'TRANSCRIPTION_ERROR', 'ENROLLMENT_MISSING'].includes(res.normalized_result)) {
      return { status: 'hold', detail: res.normalized_result }
    }
    return { status: 'blocked', detail: res.normalized_result }
  }

  return [
    { label: 'Request Created', status: 'done', detail: session.requested_action },
    { label: 'Challenge Generated', status: session.latest_challenge ? 'done' : 'pending', detail: session.latest_challenge?.status ?? 'Pending' },
    {
      label: 'Audio Received',
      status: session.verification_results.length > 0 ? 'done' : 'pending',
      detail: session.verification_results.length > 0 ? 'Validated' : isClosed ? session.status : 'Waiting',
    },
    { label: 'Aletheia Checked', ...checkTone(aletheia) },
    { label: 'Eidos Completed', ...checkTone(eidos) },
    { label: 'Challenge Validated', ...checkTone(challenge) },
    {
      label: 'Policy Evaluated',
      status: outcome === 'PASS' ? 'done' : outcome === 'REJECT' ? 'blocked' : outcome ? 'hold' : 'pending',
      detail: outcome ?? (isClosed ? session.status : 'Pending'),
    },
    {
      label: 'Authorization',
      status: tok ? 'done' : outcome === 'REJECT' ? 'blocked' : isClosed || !outcome ? 'pending' : 'hold',
      detail: tok ? 'Token Issued' : isClosed || !outcome ? session.status : 'Denied / Held',
    },
    {
      label: 'Token / Execution',
      status: tok?.status === 'CONSUMED' ? 'done' : tok?.status === 'ACTIVE' ? 'hold' : isClosed || !outcome ? 'pending' : 'blocked',
      detail: tok ? tok.status : isClosed || !outcome ? 'Not issued' : 'Blocked',
    },
  ]
}
