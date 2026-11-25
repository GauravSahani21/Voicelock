import { useEffect, useState } from 'react'
import { Sliders } from 'lucide-react'
import { api } from '../services/api'
import { IndustryBadge, RiskBadge } from '../components/ui/Badges'
import type { IndustryPolicy } from '../types'

export function SecurityPolicies() {
  const [policies, setPolicies] = useState<IndustryPolicy[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .listPolicies()
      .then(setPolicies)
      .catch(() => setPolicies([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Deterministic Industry Security Policies</h1>
        <p className="text-sm text-zinc-500 mt-1">
          One shared verification gateway configured through versioned rules. Zero LLM involvement in access decisions.
        </p>
      </div>

      {loading ? (
        <div className="vl-surface rounded-2xl p-10 text-center text-sm text-zinc-500">
          Loading policy configurations...
        </div>
      ) : (
        <div className="space-y-6">
          {policies.map((pol) => (
            <section key={pol.policy_id} className="vl-surface rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-3 bg-white">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-zinc-100 text-zinc-700 flex items-center justify-center shrink-0">
                    <Sliders className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-950">{pol.display_name}</h2>
                    <p className="text-xs text-zinc-500">{pol.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <IndustryBadge industry={pol.industry} />
                  <span className="rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 text-[11px] font-mono text-zinc-700">
                    {pol.policy_id} v{pol.version}
                  </span>
                </div>
              </div>

              <div tabIndex={0} role="region" aria-label={`${pol.industry} policy actions`} className="vl-table-wrapper">
                <table className="vl-responsive-table text-left text-xs">
                  <thead className="bg-zinc-50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200/80">
                    <tr>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Risk</th>
                      <th className="px-4 py-3">Required Checks</th>
                      <th className="px-4 py-3">Fake / Mismatch</th>
                      <th className="px-4 py-3">Missing / Outage</th>
                      <th className="px-4 py-3">Token TTL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {pol.actions.map((act) => (
                      <tr key={act.action} className="hover:bg-zinc-50/50">
                        <th scope="row" data-label="Action" className="px-4 py-3 font-medium text-zinc-950">
                          <div className="font-mono font-semibold">{act.action}</div>
                          <div className="text-[11px] font-normal text-zinc-500">{act.label}</div>
                          {act.allowed_user_roles && (
                            <div className="text-[11px] text-zinc-600 mt-0.5">
                              Roles: {act.allowed_user_roles.join(', ')}
                            </div>
                          )}
                        </th>
                        <td data-label="Risk" className="px-4 py-3">
                          <RiskBadge risk={act.risk_level} />
                        </td>
                        <td data-label="Checks" className="px-4 py-3 space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {act.require_challenge && (
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-700">
                                Challenge
                              </span>
                            )}
                            {act.require_aletheia && (
                              <span className="rounded-full bg-sky-50 text-sky-700 border border-sky-200/80 px-2 py-0.5 font-mono text-[11px]">
                                Aletheia
                              </span>
                            )}
                            {act.require_eidos && (
                              <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/80 px-2 py-0.5 font-mono text-[11px]">
                                Eidos
                              </span>
                            )}
                            {act.always_require_step_up && (
                              <span className="rounded-full bg-amber-50 text-amber-800 border border-amber-200/80 px-2 py-0.5 font-mono text-[11px]">
                                +Step-Up
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Fake / Mismatch" className="px-4 py-3 font-mono text-zinc-700">
                          {act.synthetic_voice_outcome} / {act.speaker_mismatch_outcome}
                        </td>
                        <td data-label="Missing / Outage" className="px-4 py-3 font-mono text-zinc-700">
                          {act.missing_enrollment_outcome} / {act.provider_outage_outcome}
                        </td>
                        <td data-label="Token TTL" className="px-4 py-3 font-mono text-zinc-700 vl-nums">
                          {act.token_ttl_seconds}s
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
