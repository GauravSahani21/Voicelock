import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, ArrowRight } from 'lucide-react'
import type { VerifySubmissionResponse } from '../../types'
import { ProvenanceBadge } from '../ui/Badges'

interface VerificationResultProps {
  response: VerifySubmissionResponse
  actionLabel: string
  maskedAccountDisplay: string
  attackSimulationMode?: boolean
  onContinueAction?: () => void
  onRetryVerification?: () => void
  continuing?: boolean
}

export function VerificationResult({
  response,
  actionLabel,
  maskedAccountDisplay,
  attackSimulationMode = false,
  onContinueAction,
  onRetryVerification,
  continuing = false,
}: VerificationResultProps) {
  const { decision, session, authorization_token, token_expires_at } = response
  const outcome = decision.outcome

  const aletheia = session.verification_results.find((r) => r.check_type === 'voice_authenticity')
  const eidos = session.verification_results.find((r) => r.check_type === 'speaker_verification')
  const challenge = session.verification_results.find(
    (r) => r.check_type === 'challenge_phrase' || r.check_type === 'challenge_validation',
  )

  if (attackSimulationMode) {
    const blockedBanner =
      outcome === 'REJECT'
        ? 'Unauthorized request blocked. The requested operation was not executed.'
        : outcome === 'REVIEW' || outcome === 'STEP_UP'
          ? 'Suspicious request placed on hold.'
          : 'Verification passed — the policy did not detect sufficient risk to block this recording.'

    return (
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-4">
        <div
          className={`rounded-xl border px-4 py-3 flex items-start gap-2.5 text-sm font-medium ${
            outcome === 'REJECT'
              ? 'border-rose-200 bg-rose-50/70 text-rose-800'
              : outcome === 'PASS'
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
                : 'border-amber-200 bg-amber-50/70 text-amber-800'
          }`}
        >
          {outcome === 'REJECT' ? (
            <XCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" aria-hidden="true" />
          ) : outcome === 'PASS' ? (
            <CheckCircle2 className="h-4.5 w-4.5 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <span>{blockedBanner}</span>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Security Analysis (Actual Gateway Output)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <AnalysisRow label="Aletheia (Voice Authenticity)" item={aletheia} />
            <AnalysisRow label="Eidos (Speaker Identity)" item={eidos} />
            <AnalysisRow label="Challenge Validation" item={challenge} />
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 space-y-1">
              <div className="text-zinc-500">Policy Decision</div>
              <div className="font-semibold text-zinc-950">{outcome}</div>
              <div className="text-[11px] font-mono text-zinc-600">{decision.reason_codes.join(', ')}</div>
            </div>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed pt-1">{decision.explanation}</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {outcome === 'PASS' && authorization_token && onContinueAction && (
            <button
              type="button"
              disabled={continuing}
              onClick={onContinueAction}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <span>{continuing ? 'Executing...' : `Proceed with ${actionLabel}`}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {onRetryVerification && (
            <button
              type="button"
              onClick={onRetryVerification}
              className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Run Another Impersonation Attempt
            </button>
          )}
        </div>
      </div>
    )
  }

  if (outcome === 'PASS') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-950">Identity verification successful</h3>
            <p className="text-sm text-zinc-600 mt-0.5">
              Your voice verification is complete. You may continue with the requested operation.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200/80 bg-white grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200/70 text-xs">
          <div className="p-3">
            <div className="text-zinc-500">Protected Action</div>
            <div className="font-semibold text-zinc-950 mt-0.5">{actionLabel}</div>
          </div>
          <div className="p-3">
            <div className="text-zinc-500">Account</div>
            <div className="font-semibold text-zinc-950 mt-0.5">{maskedAccountDisplay}</div>
          </div>
          <div className="p-3">
            <div className="text-zinc-500">Authorization Status</div>
            <div className="font-semibold text-emerald-700 mt-0.5 vl-nums">
              Authorized{token_expires_at ? ` · until ${new Date(token_expires_at).toLocaleTimeString()}` : ''}
            </div>
          </div>
        </div>

        {authorization_token && onContinueAction && (
          <button
            type="button"
            disabled={continuing}
            onClick={onContinueAction}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <span>{continuing ? 'Completing Request...' : `Complete ${actionLabel}`}</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }

  if (outcome === 'STEP_UP') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 className="text-base font-semibold text-zinc-950">Additional verification required</h3>
            <p className="text-sm text-zinc-700 mt-1">
              An extra verification step is needed before continuing with <strong>{actionLabel}</strong>.
              Enroll your voice profile first or complete in-person ID verification.
            </p>
          </div>
        </div>
        {onRetryVerification && (
          <button
            type="button"
            onClick={onRetryVerification}
            className="rounded-full border border-amber-300 bg-white px-4 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Try Verification Again
          </button>
        )}
      </div>
    )
  }

  if (outcome === 'REVIEW') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 space-y-2">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 className="text-base font-semibold text-zinc-950">
              Request placed under additional security review
            </h3>
            <p className="text-sm text-zinc-700 mt-1">
              For your protection, <strong>{actionLabel}</strong> is temporarily on hold while a security
              specialist completes a manual check.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 space-y-3">
      <div className="flex items-start gap-3">
        <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold text-zinc-950">Verification unsuccessful</h3>
          <p className="text-sm text-zinc-700 mt-1">
            We could not verify that the recording matches the authorized account holder or security phrase.
            For your safety, <strong>{actionLabel}</strong> was not executed.
          </p>
          <p className="text-xs text-rose-700 mt-2">
            Alternative: Verify with government photo ID at an authorized desk or retry with a clear recording.
          </p>
        </div>
      </div>
      {onRetryVerification && (
        <button
          type="button"
          onClick={onRetryVerification}
          className="rounded-full border border-rose-200 bg-white px-4 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
        >
          Start New Verification Attempt
        </button>
      )}
    </div>
  )
}

function AnalysisRow({
  label,
  item,
}: {
  label: string
  item?: { normalized_result: string; provider_mode: string; error_code: string | null }
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/60 p-3 space-y-1">
      <div className="text-zinc-500">{label}</div>
      {item ? (
        <>
          <div className="font-semibold text-zinc-950">{item.normalized_result}</div>
          <div className="pt-0.5">
            <ProvenanceBadge mode={item.provider_mode} />
          </div>
          {item.error_code && <div className="text-[11px] text-rose-600">{item.error_code}</div>}
        </>
      ) : (
        <div className="font-medium text-zinc-500">Not required by policy</div>
      )}
    </div>
  )
}
