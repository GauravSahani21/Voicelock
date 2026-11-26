import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Power,
  RefreshCw,
  Send,
  Workflow,
  XCircle,
} from 'lucide-react'
import { api, ApiClientError } from '../services/api'
import type { AutomationStatus, WebhookDeliveryItem } from '../types'

export function AutomationCenter() {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [st, delivs] = await Promise.all([
        api.automationStatus(),
        api.automationDeliveries(),
      ])
      setStatus(st)
      setDeliveries(delivs)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load Automation Center.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleToggle = async () => {
    if (!status) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await api.automationToggle(!status.n8n_enabled)
      setStatus(updated)
      setMessage(`n8n automation ${updated.n8n_enabled ? 'enabled' : 'disabled'}.`)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to toggle automation.')
    } finally {
      setBusy(false)
    }
  }

  const handleTestWebhook = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await api.automationTestWebhook()
      setMessage(
        res.status === 'DELIVERED'
          ? `Test webhook delivered (${res.event_id}).`
          : `Test webhook attempted (${res.status}): ${res.last_error || 'Check n8n endpoint.'}`,
      )
      await loadData()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Test webhook failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleRetry = async (deliveryId: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.automationRetryDelivery(deliveryId)
      setMessage(`Retry finished with status: ${res.status}`)
      await loadData()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Retry failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 mb-2">
            <Workflow className="h-3.5 w-3.5 text-zinc-900" />
            <span>n8n Security Operations Console</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Automation Center</h1>
          <p className="text-sm text-zinc-600 mt-1 max-w-2xl">
            Monitor n8n webhook connectivity, durable outbox deliveries, and importable security workflows.
            FastAPI remains the sole authority for voice verification and authorization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !status}
            onClick={() => void handleToggle()}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium border ${
              status?.n8n_enabled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            <span>{status?.n8n_enabled ? 'Automation Enabled' : 'Automation Disabled'}</span>
          </button>

          <button
            type="button"
            disabled={busy || !status?.webhook_configured}
            onClick={() => void handleTestWebhook()}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Test Webhook</span>
          </button>

          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Status & Delivery KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="vl-surface rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500">n8n Connection</div>
          <div className="text-sm font-semibold text-zinc-950 mt-1 uppercase flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${
              status?.connection_status === 'connected' ? 'bg-emerald-500' : status?.connection_status === 'disabled' ? 'bg-zinc-400' : 'bg-amber-500'
            }`} />
            {status?.connection_status ?? (loading ? '...' : 'unknown')}
          </div>
        </div>
        <div className="vl-surface rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500">Total Events</div>
          <div className="text-xl font-semibold text-zinc-950 mt-1 vl-nums">{status?.total_events_sent ?? 0}</div>
        </div>
        <div className="vl-surface rounded-2xl p-4">
          <div className="text-[11px] text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Delivered</div>
          <div className="text-xl font-semibold text-zinc-950 mt-1 vl-nums">{status?.delivered_count ?? 0}</div>
        </div>
        <div className="vl-surface rounded-2xl p-4">
          <div className="text-[11px] text-amber-700 flex items-center gap-1"><Activity className="h-3 w-3" /> Pending</div>
          <div className="text-xl font-semibold text-zinc-950 mt-1 vl-nums">{status?.pending_count ?? 0}</div>
        </div>
        <div className="vl-surface rounded-2xl p-4">
          <div className="text-[11px] text-rose-700 flex items-center gap-1"><XCircle className="h-3 w-3" /> Failed</div>
          <div className="text-xl font-semibold text-zinc-950 mt-1 vl-nums">{status?.failed_count ?? 0}</div>
        </div>
        <div className="vl-surface rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500">Last Delivery</div>
          <div className="text-xs font-medium text-zinc-900 mt-1.5">
            {status?.last_successful_delivery ? new Date(status.last_successful_delivery).toLocaleString() : 'None yet'}
          </div>
        </div>
      </div>

      {/* Workflow Catalog */}
      <div className="vl-surface rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-950">n8n Security Workflows (automation/n8n/workflows/)</h2>
          <span className="text-[11px] text-zinc-500">Import JSON files into n8n to activate</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(status?.workflows || []).map((wf) => (
            <div key={wf.id} className="rounded-xl border border-zinc-200 p-4 space-y-1.5 bg-zinc-50/50">
              <div className="text-xs font-semibold text-zinc-950">{wf.name}</div>
              <div className="text-[11px] font-mono text-zinc-500">{wf.filename}</div>
              <p className="text-xs text-zinc-600">{wf.description}</p>
              <div className="pt-1 text-[11px] text-zinc-500">Trigger: {wf.trigger}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Delivery History */}
      <div className="vl-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-950">Recent Webhook Event Deliveries</h2>
          <span className="text-xs text-zinc-500 vl-nums">{deliveries.length} records</span>
        </div>
        {deliveries.length === 0 ? (
          <div className="p-10 text-center text-xs text-zinc-500">
            No webhook deliveries recorded yet. Complete a verification or click Test Webhook.
          </div>
        ) : (
          <div className="vl-table-wrapper">
            <table className="w-full text-left text-xs vl-responsive-table">
              <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                <tr>
                  <th className="px-4 py-3 font-medium">Event ID</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Attempts</th>
                  <th className="px-4 py-3 font-medium">Error / HTTP</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 font-mono text-zinc-900" data-label="Event ID">{d.event_id}</td>
                    <td className="px-4 py-3 text-zinc-700" data-label="Type">{d.event_type}</td>
                    <td className="px-4 py-3" data-label="Status">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        d.status === 'DELIVERED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : d.status === 'PENDING'
                            ? 'bg-amber-50 text-amber-700'
                            : d.status === 'SKIPPED_DISABLED'
                              ? 'bg-zinc-100 text-zinc-600'
                              : 'bg-rose-50 text-rose-700'
                      }`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 vl-nums" data-label="Attempts">{d.attempt_count}/{d.max_attempts}</td>
                    <td className="px-4 py-3 text-zinc-500 max-w-xs truncate" data-label="Error">
                      {d.last_error || (d.http_status ? `HTTP ${d.http_status}` : '—')}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 vl-nums" data-label="Created">
                      {new Date(d.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right" data-label="Action">
                      {['FAILED', 'DEAD_LETTER', 'SKIPPED_DISABLED'].includes(d.status) && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRetry(d.id)}
                          className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                        >
                          Retry
                        </button>
                      )}
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
