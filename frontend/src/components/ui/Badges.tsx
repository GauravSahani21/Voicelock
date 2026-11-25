import type { ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, Radio, FlaskConical, Cpu } from 'lucide-react'

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const styles: Record<string, { cls: string; icon: ReactNode; label: string }> = {
    PASS: {
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
      icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
      label: 'PASS',
    },
    STEP_UP: {
      cls: 'bg-amber-50 text-amber-800 border-amber-200',
      icon: <ShieldAlert className="h-3 w-3" aria-hidden="true" />,
      label: 'STEP_UP',
    },
    REVIEW: {
      cls: 'bg-amber-50 text-amber-700 border-amber-200/80',
      icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
      label: 'REVIEW',
    },
    REJECT: {
      cls: 'bg-rose-50 text-rose-700 border-rose-200/80',
      icon: <XCircle className="h-3 w-3" aria-hidden="true" />,
      label: 'REJECT',
    },
  }
  const s = styles[outcome] ?? {
    cls: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    icon: null,
    label: outcome,
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.icon}
      <span>{s.label}</span>
    </span>
  )
}

export function ProvenanceBadge({ mode }: { mode: string }) {
  if (mode === 'LIVE_PROVIDER_CHECK') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-700">
        <Radio className="h-3 w-3 text-emerald-600" aria-hidden="true" />
        Live Provider
      </span>
    )
  }
  if (mode === 'SIMULATED_TEST_SCENARIO') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200/80 bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
        <FlaskConical className="h-3 w-3" aria-hidden="true" />
        Simulated Scenario
      </span>
    )
  }
  if (mode === 'MOCK_DEV_ADAPTER') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Mock Adapter
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700">
      <Cpu className="h-3 w-3" aria-hidden="true" />
      {mode}
    </span>
  )
}

export function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    low: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    medium: 'bg-blue-50 text-blue-700 border-blue-200/80',
    high: 'bg-amber-50 text-amber-800 border-amber-200/80',
    critical: 'bg-rose-50 text-rose-700 border-rose-200/80',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${map[risk] ?? map.medium}`}>
      {risk}
    </span>
  )
}

export function IndustryBadge({ industry }: { industry: string }) {
  const map: Record<string, string> = {
    telecom: 'bg-sky-50 text-sky-700 border-sky-200/80',
    helpdesk: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
    banking: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
    education: 'bg-amber-50 text-amber-800 border-amber-200/80',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${map[industry] ?? 'bg-zinc-100 text-zinc-700 border-zinc-200'}`}>
      {industry}
    </span>
  )
}
