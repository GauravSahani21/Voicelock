import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Mic,
  ArrowRight,
  Swords,
  RefreshCw,
  Clock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLivePolling } from '../hooks/useLivePolling'
import { api } from '../services/api'
import type { DashboardOverview } from '../types'
import { IndustryBadge, OutcomeBadge, ProvenanceBadge } from '../components/ui/Badges'

export function Overview() {
  const { selectedTenantId, selectedTenant, providerStatus, refreshProviderStatus } = useAuth()
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includeSimulated, setIncludeSimulated] = useState(true)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const navigate = useNavigate()

  const fetchOverview = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        const res = await api.dashboardOverview(selectedTenantId || undefined, includeSimulated)
        setData(res)
        setError(null)
        setLastSyncedAt(new Date())
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [selectedTenantId, includeSimulated],
  )

  useEffect(() => {
    void fetchOverview(false)
  }, [fetchOverview])

  useLivePolling(
    () => {
      void fetchOverview(true)
    },
    { intervalMs: 4000, enabled: true },
  )

  const handleManualRefresh = async () => {
    await Promise.all([fetchOverview(true), refreshProviderStatus().catch(() => {})])
  }

  const totalEvaluated = data?.evaluated_requests ?? 0

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Security Operations Overview</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {selectedTenant
              ? `Scoped to ${selectedTenant.name} (${selectedTenant.industry})`
              : 'Live telemetry across Telecom, Helpdesk, Banking, and Education'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 vl-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span>Live{lastSyncedAt ? ` · ${lastSyncedAt.toLocaleTimeString()}` : ''}</span>
          </div>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleManualRefresh()}
            aria-label="Refresh telemetry"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-full px-3.5 py-1.5 cursor-pointer hover:bg-zinc-50 transition-colors">
            <input
              type="checkbox"
              checked={includeSimulated}
              onChange={(e) => setIncludeSimulated(e.target.checked)}
              className="rounded border-zinc-300 text-zinc-950"
            />
            <span>Include Simulator</span>
          </label>

          <Link
            to="/security/verify"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 transition-colors"
          >
            <span>New Verification</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {providerStatus?.provider_mode === 'mock' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
            <span>
              <strong>Mock Dev Adapter Active:</strong> <code>DETECTIF_API_KEY</code> is unset; live checks use labelled mock responses.
            </span>
          </div>
          <Link to="/security/settings" className="text-xs font-semibold underline hover:text-amber-700">
            Provider Config
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-28 rounded-2xl border border-zinc-200/80 bg-white animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Spacious 3-Column KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Total Sessions"
              value={data.total_requests}
              sub={`${data.live_workflow_requests} live workflows · ${data.simulated_scenario_requests} simulated runs`}
              iconBg="bg-zinc-100 text-zinc-700"
              icon={<Activity className="h-4 w-4" />}
            />
            <KpiCard
              label="Approved (PASS)"
              value={data.approved_requests}
              sub={`${totalEvaluated} evaluated total · authorized operations`}
              iconBg="bg-emerald-50 text-emerald-700"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <KpiCard
              label="Rejected"
              value={data.rejected_requests}
              sub="Blocked impersonation, synthetic, or replay attempts"
              iconBg="bg-rose-50 text-rose-700"
              icon={<XCircle className="h-4 w-4" />}
            />
            <KpiCard
              label="Review & Step-Up"
              value={data.review_requests + data.step_up_requests}
              sub={`${data.review_requests} manual review · ${data.step_up_requests} step-up required`}
              iconBg="bg-amber-50 text-amber-700"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <KpiCard
              label="Pending & Closed"
              value={data.pending_requests}
              sub={`${data.expired_or_cancelled_requests} expired or cancelled · ${data.failed_provider_checks} provider errs`}
              iconBg="bg-zinc-100 text-zinc-600"
              icon={<Clock className="h-4 w-4" />}
            />
            <KpiCard
              label="Enrolled Speakers"
              value={data.active_enrollments}
              sub="Active Detectif.ai Eidos voiceprints"
              iconBg="bg-sky-50 text-sky-700"
              icon={<Mic className="h-4 w-4" />}
            />
          </div>

          {data.total_requests === 0 ? (
            <div className="vl-surface rounded-2xl p-12 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-zinc-100 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-zinc-700" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-950">
                  No Verification Sessions Recorded Yet
                </h2>
                <p className="text-sm text-zinc-500 max-w-lg mx-auto mt-1">
                  Enroll a voice profile, run an industry workflow, or execute deterministic scenarios in the Attack Simulator.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Link
                  to="/security/workflows"
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-2 text-xs font-medium text-white hover:bg-zinc-800"
                >
                  Launch Industry Workflow
                </Link>
                <Link
                  to="/security/simulator"
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <Swords className="h-3.5 w-3.5" aria-hidden="true" />
                  Run Attack Simulator
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Decision Distribution */}
              <div className="lg:col-span-6 vl-surface rounded-2xl p-6 space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-950">Decision Distribution</h2>
                  <span className="text-xs text-zinc-500 vl-nums">
                    {totalEvaluated} evaluated · {data.pending_requests} pending · {data.expired_or_cancelled_requests} closed
                  </span>
                </div>
                <div className="space-y-4">
                  {[
                    { key: 'PASS', color: 'bg-emerald-500', label: 'PASS · Authorized' },
                    { key: 'STEP_UP', color: 'bg-amber-500', label: 'STEP_UP · Extra Factor' },
                    { key: 'REVIEW', color: 'bg-amber-400', label: 'REVIEW · Human Hold' },
                    { key: 'REJECT', color: 'bg-rose-500', label: 'REJECT · Blocked' },
                  ].map((item) => {
                    const count = data.decision_distribution[item.key] ?? 0
                    const pct = totalEvaluated > 0 ? Math.round((count / totalEvaluated) * 100) : 0
                    return (
                      <div key={item.key} className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium text-zinc-700">{item.label}</span>
                          <span className="font-mono text-zinc-600 vl-nums">
                            {count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${item.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Industry Activity */}
              <div className="lg:col-span-6 vl-surface rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-950">Industry Gateway Activity</h2>
                  <Link to="/security/workflows" className="text-xs font-medium text-zinc-600 hover:text-zinc-950">
                    Open Workflows &rarr;
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-3.5">
                  {(['telecom', 'helpdesk', 'banking', 'education'] as const).map((ind) => (
                    <div key={ind} className="rounded-xl border border-zinc-200/70 p-4 bg-zinc-50/50">
                      <IndustryBadge industry={ind} />
                      <div className="mt-3 text-2xl font-semibold text-zinc-950 vl-nums">
                        {data.industry_activity[ind] ?? 0}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">Sessions</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Suspicious / Held Requests */}
              <div className="lg:col-span-7 vl-surface rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-950">
                    Recent Suspicious &amp; Held Requests
                  </h2>
                  <Link to="/security/requests" className="text-xs font-medium text-zinc-600 hover:text-zinc-950">
                    View All &rarr;
                  </Link>
                </div>
                {data.recent_suspicious_requests.length === 0 ? (
                  <p className="text-sm text-zinc-500 py-8 text-center">
                    No rejected, review, or step-up requests recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-100">
                    {data.recent_suspicious_requests.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/security/decisions/${s.id}`)}
                        className="w-full text-left py-3 px-2.5 -mx-2.5 rounded-xl hover:bg-zinc-50 flex flex-wrap items-center justify-between gap-2 transition-colors"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-zinc-950 font-mono">
                              {s.requested_action}
                            </span>
                            <IndustryBadge industry={s.industry} />
                            <ProvenanceBadge mode={s.source_mode} />
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">
                            {s.user_name} ({s.user_external_reference}) · {s.decision?.reason_codes.join(', ')}
                          </div>
                        </div>
                        <OutcomeBadge
                          outcome={
                            s.status === 'HUMAN_APPROVED'
                              ? 'PASS'
                              : s.status === 'HUMAN_REJECTED'
                                ? 'REJECT'
                                : (s.decision?.outcome ?? s.status)
                          }
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Audit Feed */}
              <div className="lg:col-span-5 vl-surface rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-950">Recent Audit Events</h2>
                  <Link to="/security/audit" className="text-xs font-medium text-zinc-600 hover:text-zinc-950">
                    Full Log &rarr;
                  </Link>
                </div>
                <ul className="divide-y divide-zinc-100 max-h-80 overflow-y-auto">
                  {data.recent_activity.map((ev) => (
                    <li key={ev.id} className="py-2.5 text-xs first:pt-1 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-medium text-zinc-900">{ev.event_type}</span>
                        <span className="text-[11px] text-zinc-400 vl-nums">
                          {new Date(ev.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-zinc-500 mt-0.5 truncate">
                        {ev.actor_reference}
                        {ev.tenant_name ? ` · ${ev.tenant_name}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function KpiCard({
  label,
  value,
  sub,
  iconBg,
  icon,
}: {
  label: string
  value: number
  sub: string
  iconBg: string
  icon: React.ReactNode
}) {
  return (
    <div className="vl-surface rounded-2xl p-5 flex flex-col justify-between gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div>
        <div className="text-3xl font-semibold tracking-tight text-zinc-950 vl-nums">{value}</div>
        <div className="mt-1 text-xs text-zinc-500">{sub}</div>
      </div>
    </div>
  )
}
