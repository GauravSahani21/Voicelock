import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLivePolling } from '../hooks/useLivePolling'
import { api } from '../services/api'
import type { AuditEventItem } from '../types'

export function AuditLogs() {
  const { selectedTenantId } = useAuth()
  const [events, setEvents] = useState<AuditEventItem[]>([])
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)

  const loadAudit = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)
      try {
        const res = await api.listAuditEvents({
          tenant_id: selectedTenantId || undefined,
          event_type: eventTypeFilter.trim() || undefined,
        })
        setEvents(res)
        setLastSyncedAt(new Date())
      } catch {
        if (!silent) setEvents([])
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [selectedTenantId, eventTypeFilter],
  )

  useEffect(() => {
    void loadAudit(false)
  }, [loadAudit])

  useLivePolling(
    () => {
      void loadAudit(true)
    },
    { intervalMs: 4000, enabled: true },
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">Immutable Audit Logs</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Live trace of enrollments, fresh challenges, provider calls, policy evaluations, and token events.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 vl-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span>Live{lastSyncedAt ? ` · ${lastSyncedAt.toLocaleTimeString()}` : ''}</span>
          </span>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadAudit(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <div className="relative w-full sm:w-64">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5" aria-hidden="true" />
            <input
              type="text"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              placeholder="Filter event (e.g. decision)"
              className="w-full rounded-full border border-zinc-200 bg-white pl-9 pr-3 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="vl-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-500">Loading audit events...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">No audit events recorded yet.</div>
        ) : (
          <div tabIndex={0} role="region" aria-label="Audit events table" className="vl-table-wrapper">
            <table className="vl-responsive-table text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200/80 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Event Type</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Session</th>
                  <th className="px-4 py-3">Event Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-zinc-50/70">
                    <td data-label="Timestamp" className="px-4 py-3 text-zinc-500 whitespace-nowrap vl-nums">
                      {new Date(ev.created_at).toLocaleString()}
                    </td>
                    <th scope="row" data-label="Event Type" className="px-4 py-3 font-mono font-semibold text-zinc-950">
                      {ev.event_type}
                    </th>
                    <td data-label="Actor" className="px-4 py-3 text-zinc-700">{ev.actor_reference}</td>
                    <td data-label="Tenant" className="px-4 py-3 text-zinc-600">{ev.tenant_name ?? 'Global'}</td>
                    <td data-label="Session" className="px-4 py-3 font-mono">
                      {ev.session_id ? (
                        <Link to={`/security/decisions/${ev.session_id}`} className="text-blue-600 hover:underline">
                          {ev.session_id.slice(0, 8)}...
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label="Details" className="px-4 py-3">
                      <code className="text-[11px] font-mono text-zinc-600 break-all">
                        {JSON.stringify(ev.event_details)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
