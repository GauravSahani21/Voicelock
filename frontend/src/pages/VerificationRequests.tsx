import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Plus, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLivePolling } from '../hooks/useLivePolling'
import { api } from '../services/api'
import type { SessionDetail } from '../types'
import { IndustryBadge, OutcomeBadge, ProvenanceBadge } from '../components/ui/Badges'

export function VerificationRequests() {
  const { selectedTenantId } = useAuth()
  const [sessions, setSessions] = useState<SessionDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [industryFilter, setIndustryFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const navigate = useNavigate()

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        const res = await api.listSessions({
          tenant_id: selectedTenantId || undefined,
          industry: industryFilter || undefined,
          outcome: outcomeFilter || undefined,
        })
        setSessions(res)
        setLastSyncedAt(new Date())
      } catch {
        if (!silent) setSessions([])
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [selectedTenantId, industryFilter, outcomeFilter],
  )

  useEffect(() => {
    void loadSessions(false)
  }, [loadSessions])

  useLivePolling(
    () => {
      void loadSessions(true)
    },
    { intervalMs: 4000, enabled: true },
  )

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (actionFilter && !s.requested_action.toLowerCase().includes(actionFilter.toLowerCase())) {
        return false
      }
      if (dateFilter) {
        const day = s.created_at.slice(0, 10)
        if (day !== dateFilter) return false
      }
      return true
    })
  }, [sessions, actionFilter, dateFilter])

  const effectiveOutcome = (s: SessionDetail) =>
    s.status === 'HUMAN_APPROVED'
      ? 'PASS'
      : s.status === 'HUMAN_REJECTED'
        ? 'REJECT'
        : (s.decision?.outcome ?? s.status)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">Verification Requests</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Live verification sessions, model verdicts, challenge status, and authorization tokens.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 vl-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span>Live{lastSyncedAt ? ` · ${lastSyncedAt.toLocaleTimeString()}` : ''}</span>
          </span>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadSessions(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <Link
            to="/security/verify"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Request</span>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="vl-surface rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor="filter-industry" className="block text-xs font-medium text-zinc-600 mb-1">
            Industry
          </label>
          <select
            id="filter-industry"
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">All Industries</option>
            <option value="telecom">Telecom</option>
            <option value="helpdesk">Helpdesk</option>
            <option value="banking">Banking</option>
            <option value="education">Education</option>
          </select>
        </div>

        <div>
          <label htmlFor="filter-outcome" className="block text-xs font-medium text-zinc-600 mb-1">
            Decision
          </label>
          <select
            id="filter-outcome"
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">All Outcomes</option>
            <option value="PASS">PASS</option>
            <option value="STEP_UP">STEP_UP</option>
            <option value="REVIEW">REVIEW</option>
            <option value="REJECT">REJECT</option>
          </select>
        </div>

        <div>
          <label htmlFor="filter-action" className="block text-xs font-medium text-zinc-600 mb-1">
            Requested Action
          </label>
          <div className="relative">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-2" aria-hidden="true" />
            <input
              id="filter-action"
              type="text"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              placeholder="e.g. sim_replacement"
              className="w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="filter-date" className="block text-xs font-medium text-zinc-600 mb-1">
            Date
          </label>
          <input
            id="filter-date"
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Responsive Data Table */}
      <div className="vl-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading verification requests...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No matching verification requests found.
          </div>
        ) : (
          <div tabIndex={0} role="region" aria-label="Verification requests table" className="vl-table-wrapper">
            <table className="vl-responsive-table text-left text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200/80 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Verification ID</th>
                  <th className="px-4 py-3">Industry &amp; User</th>
                  <th className="px-4 py-3">Protected Action</th>
                  <th className="px-4 py-3">Aletheia</th>
                  <th className="px-4 py-3">Eidos</th>
                  <th className="px-4 py-3">Challenge</th>
                  <th className="px-4 py-3">Policy / Final</th>
                  <th className="px-4 py-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((s) => {
                  const aletheia = s.verification_results.find((r) => r.check_type === 'voice_authenticity')
                  const eidos = s.verification_results.find((r) => r.check_type === 'speaker_verification')
                  const challenge = s.verification_results.find(
                    (r) => r.check_type === 'challenge_phrase' || r.check_type === 'challenge_validation',
                  )
                  return (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/security/decisions/${s.id}`)}
                      className="hover:bg-zinc-50/70 cursor-pointer transition-colors"
                    >
                      <th scope="row" data-label="Verification ID" className="px-4 py-3 font-mono text-xs text-zinc-950 font-semibold">
                        <div>{s.external_request_id || s.id.slice(0, 12)}</div>
                        <div className="mt-1">
                          <ProvenanceBadge mode={s.source_mode} />
                        </div>
                      </th>
                      <td data-label="Industry & User" className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <IndustryBadge industry={s.industry} />
                          <span className="text-xs font-medium text-zinc-900">{s.user_name.split(' (')[0]}</span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{s.user_external_reference}</div>
                      </td>
                      <td data-label="Protected Action" className="px-4 py-3">
                        <div className="text-xs font-mono font-semibold text-zinc-800">{s.requested_action}</div>
                        <div className="text-[11px] text-zinc-500 truncate max-w-[160px]">
                          {s.resource_reference}
                        </div>
                      </td>
                      <td data-label="Aletheia" className="px-4 py-3 font-mono text-xs text-zinc-700">
                        {aletheia ? aletheia.normalized_result : '—'}
                      </td>
                      <td data-label="Eidos" className="px-4 py-3 font-mono text-xs text-zinc-700">
                        {eidos ? eidos.normalized_result : '—'}
                      </td>
                      <td data-label="Challenge" className="px-4 py-3 font-mono text-xs text-zinc-700">
                        {challenge ? challenge.normalized_result : '—'}
                      </td>
                      <td data-label="Policy / Final" className="px-4 py-3 space-y-1">
                        <OutcomeBadge outcome={effectiveOutcome(s)} />
                        {(s.status === 'HUMAN_APPROVED' || s.status === 'HUMAN_REJECTED') && (
                          <div className="text-[10px] text-zinc-500">Human override</div>
                        )}
                        {s.token_summary && (
                          <div className="text-[10px] font-mono text-zinc-500">
                            Token: {s.token_summary.status}
                          </div>
                        )}
                      </td>
                      <td data-label="Timestamp" className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap vl-nums">
                        {new Date(s.created_at).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
