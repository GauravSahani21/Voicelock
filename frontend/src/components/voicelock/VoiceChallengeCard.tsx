import { Clock, RefreshCw, Volume2 } from 'lucide-react'
import type { Challenge } from '../../types'

interface VoiceChallengeCardProps {
  challenge: Challenge
  secondsLeft: number
  disabled?: boolean
  onRefresh: () => void
}

export function VoiceChallengeCard({
  challenge,
  secondsLeft,
  disabled = false,
  onRefresh,
}: VoiceChallengeCardProps) {
  const isExpired = challenge.status === 'EXPIRED' || (challenge.status === 'ISSUED' && secondsLeft <= 0)
  const isConsumed = challenge.status === 'CONSUMED'

  return (
    <div
      className="rounded-2xl border border-zinc-800/80 bg-zinc-950 text-white p-5 sm:p-6 space-y-4"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 70% at 50% 0% var(--vl-in-oklab), rgba(255,255,255,0.06), transparent 70%)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300">
          <Volume2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          <span>Speak this security phrase clearly</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-mono font-medium vl-nums ${
              isExpired
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                : isConsumed
                  ? 'bg-zinc-800 text-zinc-300'
                  : 'bg-white/10 text-zinc-200 border border-white/15'
            }`}
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            {isConsumed ? 'Submitted' : isExpired ? 'Expired' : `${secondsLeft}s remaining`}
          </span>

          {!isConsumed && (
            <button
              type="button"
              disabled={disabled}
              onClick={onRefresh}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-zinc-200 hover:bg-white/15 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>New Phrase</span>
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-white/5 border border-white/10 px-5 py-5 text-center">
        <p className="text-xl sm:text-2xl font-medium tracking-tight text-white text-balance">
          &ldquo;{challenge.challenge_text}&rdquo;
        </p>
      </div>

      <p className="text-[11px] text-zinc-400">
        Speak steadily for at least 3–5 seconds for reliable deepfake, speaker, and phrase verification.
      </p>
    </div>
  )
}
