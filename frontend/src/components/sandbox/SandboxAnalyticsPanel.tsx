import type { SandboxAnalytics } from '../../types'

interface Props {
  analytics: SandboxAnalytics | null
  loading: boolean
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-700 capitalize">{label.replace(/_/g, ' ')}</span>
        <span className="font-mono text-zinc-900 vl-nums">{value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function SandboxAnalyticsPanel({ analytics, loading }: Props) {
  if (loading) {
    return (
      <div className="vl-surface rounded-2xl p-8 text-center text-sm text-zinc-500">
        Loading sandbox and automation analytics...
      </div>
    )
  }

  if (!analytics || analytics.summary.total_sandbox_tests === 0) {
    return (
      <div className="vl-surface rounded-2xl p-10 text-center space-y-2">
        <p className="text-sm font-semibold text-zinc-900">No Sandbox Analytics Yet</p>
        <p className="text-xs text-zinc-500 max-w-md mx-auto">
          Run your first voice verification simulation or attack lab test to populate real-time decision,
          attack distribution, industry activity, and n8n webhook delivery charts.
        </p>
      </div>
    )
  }

  const s = analytics.summary
  const attackEntries = Object.entries(analytics.attack_scenario_distribution)
  const attackMax = Math.max(1, ...attackEntries.map(([, v]) => v))
  const industryEntries = Object.entries(analytics.industry_testing_activity)
  const industryMax = Math.max(1, ...industryEntries.map(([, v]) => v))
  const autoEntries = Object.entries(analytics.automation_execution_status)
  const autoMax = Math.max(1, ...autoEntries.map(([, v]) => v))

  return (
    <div className="space-y-5">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Sandbox Tests', value: s.total_sandbox_tests },
          { label: 'Genuine Speaker', value: s.genuine_speaker_attempts },
          { label: 'Different Speaker', value: s.different_speaker_attempts },
          { label: 'Synthetic Voice', value: s.synthetic_voice_tests },
          { label: 'Approved', value: s.approved_attempts },
          { label: 'Rejected', value: s.rejected_attempts },
          { label: 'Review Decisions', value: s.review_decisions },
          { label: 'High-Risk Incidents', value: s.high_risk_incidents },
          { label: 'n8n Notifications', value: s.automation_notifications },
          { label: 'Failed Webhooks', value: s.failed_webhook_deliveries },
        ].map((kpi) => (
          <div key={kpi.label} className="vl-surface rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-zinc-500">{kpi.label}</div>
            <div className="text-xl font-semibold text-zinc-950 mt-1 vl-nums">{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Verification Decisions Over Time */}
        <div className="vl-surface rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-950">Verification Decisions Over Time</h3>
          {analytics.decisions_over_time.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4">No completed decisions yet.</p>
          ) : (
            <div className="space-y-2.5">
              {analytics.decisions_over_time.map((row) => (
                <div key={row.date} className="flex items-center justify-between text-xs border-b border-zinc-100 pb-2">
                  <span className="font-mono text-zinc-600">{row.date}</span>
                  <div className="flex items-center gap-3 vl-nums">
                    <span className="text-emerald-700 font-medium">APP: {row.APPROVED}</span>
                    <span className="text-rose-700 font-medium">REJ: {row.REJECTED}</span>
                    <span className="text-amber-700 font-medium">REV: {row.REVIEW + row.STEP_UP}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 2. Attack Scenario Distribution */}
        <div className="vl-surface rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-950">Attack Scenario Distribution</h3>
          <div className="space-y-2.5">
            {attackEntries.map(([key, val]) => (
              <BarRow key={key} label={key} value={val} max={attackMax} color="bg-zinc-900" />
            ))}
          </div>
        </div>

        {/* 3. Industry-Wise Testing Activity */}
        <div className="vl-surface rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-950">Industry-Wise Testing Activity</h3>
          <div className="space-y-2.5">
            {industryEntries.map(([key, val]) => (
              <BarRow key={key} label={key} value={val} max={industryMax} color="bg-blue-600" />
            ))}
          </div>
        </div>

        {/* 4. n8n Automation Execution Status + Incident Trends */}
        <div className="vl-surface rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950 mb-2.5">n8n Automation Delivery Status</h3>
            <div className="space-y-2">
              {autoEntries.map(([key, val]) => (
                <BarRow
                  key={key}
                  label={key}
                  value={val}
                  max={autoMax}
                  color={key === 'DELIVERED' ? 'bg-emerald-600' : key === 'FAILED' ? 'bg-rose-600' : 'bg-amber-500'}
                />
              ))}
            </div>
          </div>
          <div className="pt-2 border-t border-zinc-100">
            <h4 className="text-xs font-semibold text-zinc-800 mb-2">Security Incident Trends</h4>
            {analytics.incident_trends.length === 0 ? (
              <p className="text-xs text-zinc-500">No rejected or review incidents recorded.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {analytics.incident_trends.map((t) => (
                  <span key={t.date} className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs text-rose-800 vl-nums">
                    {t.date}: {t.incidents} incident{t.incidents === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
