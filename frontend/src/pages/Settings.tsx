import { useEffect, useState, type FormEvent } from 'react'
import { RefreshCw, Server, CheckCircle2, AlertTriangle, Plus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLivePolling } from '../hooks/useLivePolling'
import { api, ApiClientError } from '../services/api'
import type { IndustryType } from '../types'

export function Settings() {
  const {
    operator,
    tenants,
    selectedTenantId,
    providerStatus,
    refreshProviderStatus,
    refreshTenants,
  } = useAuth()

  useEffect(() => {
    void refreshProviderStatus().catch(() => {})
  }, [refreshProviderStatus])

  useLivePolling(
    () => {
      void refreshProviderStatus().catch(() => {})
    },
    { intervalMs: 12000, enabled: true },
  )

  const [refreshing, setRefreshing] = useState(false)
  const [tenantSlug, setTenantSlug] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantIndustry, setTenantIndustry] = useState<IndustryType>('telecom')

  const [userRef, setUserRef] = useState('')
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('customer')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const handleRefreshProvider = async () => {
    setRefreshing(true)
    try {
      await refreshProviderStatus()
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateTenant = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    try {
      const created = await api.createTenant({
        slug: tenantSlug.trim(),
        name: tenantName.trim(),
        industry: tenantIndustry,
      })
      setMsg(`Created tenant ${created.name} (${created.industry}).`)
      setTenantSlug('')
      setTenantName('')
      await refreshTenants()
    } catch (error: unknown) {
      setErr(error instanceof ApiClientError ? error.message : 'Failed to create tenant')
    }
  }

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault()
    const tid = selectedTenantId || tenants[0]?.id
    if (!tid) return
    setErr(null)
    setMsg(null)
    try {
      const created = await api.createTenantUser(tid, {
        external_reference: userRef.trim(),
        name: userName.trim(),
        role: userRole,
      })
      setMsg(`Added user ${created.name} (${created.external_reference}).`)
      setUserRef('')
      setUserName('')
    } catch (error: unknown) {
      setErr(error instanceof ApiClientError ? error.message : 'Failed to create user')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Provider Health, Tenants &amp; Privacy</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Inspect live Detectif.ai platform status, credential mode, audio constraints, and manage tenant accounts.
        </p>
      </div>

      {msg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {err}
        </div>
      )}

      {/* Detectif Provider Status Card */}
      <section className="vl-surface rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-zinc-100 text-zinc-700 flex items-center justify-center">
              <Server className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-950">Detectif.ai &amp; STT Provider Health</h2>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefreshProvider()}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Check Live Health</span>
          </button>
        </div>

        {providerStatus && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-1">
              <div className="text-zinc-500">Active Provider Mode</div>
              <div className="flex items-center gap-1.5 font-semibold text-zinc-950">
                {providerStatus.provider_mode === 'live' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
                <span className="uppercase">{providerStatus.provider_mode}</span>
              </div>
              <div className="text-[11px] text-zinc-500">
                API Key Configured: {providerStatus.api_key_configured ? 'Yes (backend-only)' : 'No'}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-1">
              <div className="text-zinc-500">Detectif Platform /v1/health</div>
              <div className="font-semibold text-zinc-950">
                Status: {String(providerStatus.detectif_health.status ?? 'unknown')}
              </div>
              <div className="text-[11px] text-zinc-500">
                Inference: {String(providerStatus.detectif_health.inference ?? 'unknown')} · DB:{' '}
                {String(providerStatus.detectif_health.database ?? 'unknown')}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-1">
              <div className="text-zinc-500">Detectif Credits Balance</div>
              {providerStatus.detectif_credits ? (
                <>
                  <div className="font-semibold text-zinc-950 vl-nums">
                    {providerStatus.detectif_credits.unlimited
                      ? 'Unlimited Plan'
                      : `${String(providerStatus.detectif_credits.available ?? 0)} credits`}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Plan: {String(providerStatus.detectif_credits.plan ?? 'unknown')}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-amber-700">{providerStatus.credits_error}</div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-1">
              <div className="text-zinc-500">Local Challenge STT</div>
              <div className="font-semibold text-zinc-950">faster-whisper ({providerStatus.whisper_model})</div>
              <div className="text-[11px] text-zinc-500">
                Aletheia: {providerStatus.aletheia_enabled ? 'ON' : 'OFF'} · Eidos:{' '}
                {providerStatus.eidos_enabled ? 'ON' : 'OFF'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Tenant & User Creation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {operator?.role === 'platform_admin' && (
          <form onSubmit={(e) => void handleCreateTenant(e)} className="vl-surface rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-950">Create New Tenant</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="t-slug" className="block text-xs font-medium text-zinc-700 mb-1">
                  Slug (lowercase)
                </label>
                <input
                  id="t-slug"
                  required
                  pattern="[a-z0-9-]+"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  placeholder="acme-telecom"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label htmlFor="t-ind" className="block text-xs font-medium text-zinc-700 mb-1">
                  Industry Policy
                </label>
                <select
                  id="t-ind"
                  value={tenantIndustry}
                  onChange={(e) => setTenantIndustry(e.target.value as IndustryType)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="telecom">telecom</option>
                  <option value="helpdesk">helpdesk</option>
                  <option value="banking">banking</option>
                  <option value="education">education</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="t-name" className="block text-xs font-medium text-zinc-700 mb-1">
                Display Name
              </label>
              <input
                id="t-name"
                required
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="Acme Telecom Corp"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Create Tenant</span>
            </button>
          </form>
        )}

        <form onSubmit={(e) => void handleCreateUser(e)} className="vl-surface rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-950">Add End-User to Selected Tenant</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="u-ref" className="block text-xs font-medium text-zinc-700 mb-1">
                External Reference
              </label>
              <input
                id="u-ref"
                required
                value={userRef}
                onChange={(e) => setUserRef(e.target.value)}
                placeholder="CUST-TEL-009"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label htmlFor="u-role" className="block text-xs font-medium text-zinc-700 mb-1">
                Role
              </label>
              <select
                id="u-role"
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="customer">customer</option>
                <option value="employee">employee</option>
                <option value="student">student</option>
                <option value="faculty">faculty</option>
                <option value="administrator">administrator</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="u-name" className="block text-xs font-medium text-zinc-700 mb-1">
              Full Name
            </label>
            <input
              id="u-name"
              required
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Alex Rivera"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Create User</span>
          </button>
        </form>
      </div>
    </div>
  )
}
