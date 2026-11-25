import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, Play, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api, ApiClientError } from '../services/api'
import { OutcomeBadge, ProvenanceBadge } from '../components/ui/Badges'
import type { EndUser, IndustryPolicy, SimulatorRunResponse, SimulatorScenario } from '../types'

export function AttackSimulator() {
  const { tenants, selectedTenantId, setSelectedTenantId } = useAuth()
  const [scenarios, setScenarios] = useState<SimulatorScenario[]>([])
  const [tenantId, setTenantId] = useState(selectedTenantId || '')
  const [users, setUsers] = useState<EndUser[]>([])
  const [userId, setUserId] = useState('')
  const [policy, setPolicy] = useState<IndustryPolicy | null>(null)
  const [action, setAction] = useState('')
  const [activeScenarioId, setActiveScenarioId] = useState<string>('')

  const [runResult, setRunResult] = useState<SimulatorRunResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listSimulatorScenarios().then((list) => {
      setScenarios(list)
      if (list.length > 0) setActiveScenarioId(list[0].scenario_id)
    })
  }, [])

  useEffect(() => {
    if (!tenantId && selectedTenantId) setTenantId(selectedTenantId)
    else if (!tenantId && tenants.length > 0) setTenantId(tenants[0].id)
  }, [selectedTenantId, tenants, tenantId])

  const tenant = tenants.find((t) => t.id === tenantId) ?? null

  useEffect(() => {
    if (!tenant) return
    Promise.all([api.listTenantUsers(tenant.id), api.getPolicy(tenant.industry)])
      .then(([uList, pol]) => {
        setUsers(uList)
        setUserId(uList[0]?.id ?? '')
        setPolicy(pol)
        setAction(pol.actions[0]?.action ?? '')
      })
      .catch(() => {})
  }, [tenant])

  const handleRunScenario = async (scenarioId: string) => {
    if (!tenantId || !userId) return
    setActiveScenarioId(scenarioId)
    setRunning(true)
    setError(null)
    try {
      const res = await api.runSimulatorScenario({
        scenario_id: scenarioId,
        tenant_id: tenantId,
        user_id: userId,
        action: action || undefined,
      })
      setRunResult(res)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Simulator run failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Attack &amp; Resilience Simulator</h1>
            <ProvenanceBadge mode="SIMULATED_TEST_SCENARIO" />
          </div>
          <p className="text-sm text-zinc-500 mt-1">
            Deterministic test fixtures demonstrating policy rules, replay locks, and fail-safe outage handling across 12 scenarios.
          </p>
        </div>
      </div>

      {/* Separation Notice */}
      <div className="rounded-2xl border border-violet-200/80 bg-violet-50/60 px-4 py-3 flex items-start gap-2.5 text-xs text-violet-950">
        <FlaskConical className="h-4 w-4 text-violet-700 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          <strong>Simulated Test Scenario Mode:</strong> Injects deterministic fixtures through the real Policy Engine,
          Token Guard, and Audit Trail — separated cleanly from live Detectif.ai checks.
        </span>
      </div>

      {/* Target Context Bar */}
      <div className="vl-surface rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="sim-tenant" className="block text-xs font-medium text-zinc-600 mb-1">
            Target Tenant / Industry Policy
          </label>
          <select
            id="sim-tenant"
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
          <label htmlFor="sim-user" className="block text-xs font-medium text-zinc-600 mb-1">
            Target Identity
          </label>
          <select
            id="sim-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} [{u.role}]
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sim-action" className="block text-xs font-medium text-zinc-600 mb-1">
            Protected Action
          </label>
          <select
            id="sim-action"
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
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Scenario Catalog */}
        <div className="lg:col-span-5 space-y-2.5">
          {scenarios.map((sc) => {
            const active = sc.scenario_id === activeScenarioId
            return (
              <div
                key={sc.scenario_id}
                className={`rounded-2xl border p-4 transition-all ${
                  active
                    ? 'border-zinc-950 bg-white shadow-sm'
                    : 'border-zinc-200/80 bg-white hover:border-zinc-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{sc.category}</div>
                    <h2 className="text-sm font-semibold text-zinc-950 mt-0.5">{sc.title}</h2>
                  </div>
                  <button
                    type="button"
                    disabled={running || !tenantId || !userId}
                    onClick={() => void handleRunScenario(sc.scenario_id)}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 shrink-0"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    <span>Run</span>
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{sc.description}</p>
              </div>
            )
          })}
        </div>

        {/* Simulation Output Panel */}
        <div className="lg:col-span-7">
          {!runResult ? (
            <div className="vl-surface rounded-2xl border-dashed p-12 text-center space-y-2.5">
              <ShieldAlert className="h-8 w-8 text-zinc-400 mx-auto" aria-hidden="true" />
              <div className="text-sm font-semibold text-zinc-950">Select and Run an Attack Scenario</div>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Click Run on any of the 12 scenarios to inspect triggered rules, reason codes, and audit log events.
              </p>
            </div>
          ) : (
            <div className="vl-surface rounded-2xl p-6 space-y-4 sticky top-20">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-4">
                <div>
                  <span className="inline-block rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
                    {runResult.label}
                  </span>
                  <h2 className="text-base font-semibold text-zinc-950 mt-1.5">{runResult.scenario.title}</h2>
                </div>
                <OutcomeBadge outcome={runResult.actual_outcome} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-3">
                  <div className="text-zinc-500">Requested Action</div>
                  <div className="font-mono font-semibold text-zinc-950 mt-0.5">
                    {runResult.requested_action} ({runResult.industry})
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-3">
                  <div className="text-zinc-500">Policy Version</div>
                  <div className="font-mono font-semibold text-zinc-950 mt-0.5">
                    {runResult.policy_id} v{runResult.policy_version}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200/70 p-3.5 text-xs space-y-1">
                <div className="font-semibold text-zinc-700">Expected Security Behavior</div>
                <p className="text-zinc-600">{runResult.scenario.expected_security_behavior}</p>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-semibold text-zinc-700">Policy Explanation</div>
                <p className="text-sm text-zinc-800">{runResult.explanation}</p>
              </div>

              {runResult.token_replay_blocked && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
                  <span>Server-side SHA-256 single-use token replay defense confirmed!</span>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {runResult.reason_codes.map((code) => (
                  <span key={code} className="rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 text-[11px] font-mono text-zinc-800">
                    {code}
                  </span>
                ))}
              </div>

              <div>
                <div className="text-xs font-semibold text-zinc-700 mb-2">Simulated Check Fixtures</div>
                <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200/70 bg-zinc-50/50">
                  {runResult.results.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-xs px-3.5 py-2.5">
                      <span className="font-medium capitalize text-zinc-700">{r.check_type.replaceAll('_', ' ')}</span>
                      <span className="font-mono font-semibold text-zinc-950">{r.normalized_result}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-700 vl-nums">
                    Audit Events ({runResult.audit_events.length})
                  </span>
                  <Link
                    to={`/security/decisions/${runResult.session_id}`}
                    className="text-xs font-medium text-zinc-700 hover:text-zinc-950"
                  >
                    View Decision Page &rarr;
                  </Link>
                </div>
                <ul className="space-y-1.5 text-xs">
                  {runResult.audit_events.map((ev) => (
                    <li key={ev.id} className="font-mono text-zinc-600 bg-zinc-50 border border-zinc-200/60 rounded-lg px-3 py-1.5 vl-nums">
                      {ev.event_type} · {new Date(ev.created_at).toLocaleTimeString()}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
