import { CheckCircle2, Clock, AlertTriangle, XCircle, Loader2 } from 'lucide-react'

export type StageState = 'waiting' | 'processing' | 'completed' | 'failed' | 'review'

export interface VerificationStageItem {
  id: string
  label: string
  state: StageState
  detail?: string
}

export function VerificationProgress({ stages }: { stages: VerificationStageItem[] }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Security Verification Progress
      </div>

      <ol className="divide-y divide-zinc-100">
        {stages.map((st, idx) => (
          <li
            key={st.id}
            className="flex items-center justify-between gap-3 py-2.5 text-xs first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <StageIcon state={st.state} />
              <div className="min-w-0">
                <div
                  className={`font-medium truncate ${
                    st.state === 'waiting' ? 'text-zinc-500' : 'text-zinc-950'
                  }`}
                >
                  {idx + 1}. {st.label}
                </div>
                {st.detail && <div className="text-[11px] text-zinc-500 truncate">{st.detail}</div>}
              </div>
            </div>
            <span
              className={`text-[11px] font-medium shrink-0 capitalize ${
                st.state === 'completed'
                  ? 'text-emerald-700'
                  : st.state === 'failed'
                    ? 'text-rose-600'
                    : st.state === 'review'
                      ? 'text-amber-700'
                      : st.state === 'processing'
                        ? 'text-blue-600'
                        : 'text-zinc-400'
              }`}
            >
              {st.state === 'review' ? 'Requires review' : st.state}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function StageIcon({ state }: { state: StageState }) {
  if (state === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
  if (state === 'failed') return <XCircle className="h-4 w-4 text-rose-600 shrink-0" aria-hidden="true" />
  if (state === 'review') return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
  if (state === 'processing') return <Loader2 className="h-4 w-4 text-blue-600 animate-spin shrink-0" aria-hidden="true" />
  return <Clock className="h-4 w-4 text-zinc-300 shrink-0" aria-hidden="true" />
}
