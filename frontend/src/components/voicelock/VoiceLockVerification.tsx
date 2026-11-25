import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, AlertCircle, Lock } from 'lucide-react'
import { api, ApiClientError } from '../../services/api'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { VoiceChallengeCard } from './VoiceChallengeCard'
import { VoiceRecorder } from './VoiceRecorder'
import { VerificationProgress, type VerificationStageItem } from './VerificationProgress'
import { VerificationResult } from './VerificationResult'
import type { Challenge, SessionDetail, VerifySubmissionResponse } from '../../types'

export interface VoiceLockVerificationProps {
  tenantId: string
  userId: string
  action: string
  actionLabel: string
  resourceReference: string
  maskedAccountDisplay: string
  requireEidos?: boolean
  stepUpSatisfied?: boolean
  attackSimulationMode?: boolean
  onVerified: (response: VerifySubmissionResponse) => void
  onContinueAction?: (response: VerifySubmissionResponse) => void
  continuing?: boolean
  onCancel?: () => void
}

const inFlightSessionCreations = new Map<
  string,
  Promise<{ session: SessionDetail; challenge: Challenge }>
>()

function makeInitialStages(requireEidos: boolean): VerificationStageItem[] {
  return [
    { id: 'upload', label: 'Voice recording received', state: 'waiting' },
    { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'waiting' },
    {
      id: 'eidos',
      label: 'Matching enrolled speaker — Eidos',
      state: 'waiting',
      detail: requireEidos ? undefined : 'Optional under selected policy',
    },
    { id: 'phrase', label: 'Validating security phrase', state: 'waiting' },
    { id: 'policy', label: 'Evaluating security policy', state: 'waiting' },
    { id: 'decision', label: 'Finalizing authorization decision', state: 'waiting' },
  ]
}

export function VoiceLockVerification({
  tenantId,
  userId,
  action,
  actionLabel,
  resourceReference,
  maskedAccountDisplay,
  requireEidos = true,
  stepUpSatisfied = false,
  attackSimulationMode = false,
  onVerified,
  onContinueAction,
  continuing = false,
  onCancel,
}: VoiceLockVerificationProps) {
  const storageKey = `vl_active_session:${tenantId}:${userId}:${action}:${resourceReference}`
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [initializing, setInitializing] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [stages, setStages] = useState<VerificationStageItem[]>(() => makeInitialStages(requireEidos))
  const [verifyResponse, setVerifyResponse] = useState<VerifySubmissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorder = useAudioRecorder()

  const startFreshSession = useCallback(async () => {
    setInitializing(true)
    setError(null)
    setVerifyResponse(null)
    setStages(makeInitialStages(requireEidos))
    recorder.clearRecording()

    try {
      let pending = inFlightSessionCreations.get(storageKey)
      if (!pending) {
        pending = (async () => {
          const created = await api.createSession({
            tenant_id: tenantId,
            user_id: userId,
            requested_action: action,
            resource_reference: resourceReference,
            external_request_id: `PORTAL-${Date.now().toString().slice(-6)}`,
            step_up_satisfied: stepUpSatisfied,
            request_context: {
              embedded_component: 'VoiceLockVerification',
              attack_simulation: attackSimulationMode,
            },
          })
          const issued = await api.issueChallenge(created.id)
          sessionStorage.setItem(storageKey, created.id)
          return { session: created, challenge: issued }
        })().finally(() => {
          inFlightSessionCreations.delete(storageKey)
        })
        inFlightSessionCreations.set(storageKey, pending)
      }
      const { session: created, challenge: issued } = await pending
      setSession(created)
      setChallenge(issued)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to start security verification.')
    } finally {
      setInitializing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, userId, action, resourceReference, stepUpSatisfied, attackSimulationMode, requireEidos, storageKey])

  useEffect(() => {
    const savedSessionId = sessionStorage.getItem(storageKey)
    if (!savedSessionId) {
      void startFreshSession()
      return
    }
    setInitializing(true)
    api
      .getSession(savedSessionId)
      .then(async (existing) => {
        if (existing.decision) {
          setSession(existing)
          setChallenge(existing.latest_challenge)
          setInitializing(false)
          return
        }
        const expMs = new Date(existing.expires_at).getTime()
        if (expMs <= Date.now()) {
          await startFreshSession()
          return
        }
        setSession(existing)
        if (existing.latest_challenge && existing.latest_challenge.status === 'ISSUED') {
          setChallenge(existing.latest_challenge)
        } else {
          const ch = await api.issueChallenge(existing.id)
          setChallenge(ch)
        }
        setInitializing(false)
      })
      .catch(() => {
        void startFreshSession()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  useEffect(() => {
    if (!challenge) {
      setSecondsLeft(0)
      return
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(challenge.expires_at).getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [challenge])

  const handleRefreshChallenge = async () => {
    if (!session) return
    setError(null)
    try {
      const ch = await api.issueChallenge(session.id)
      setChallenge(ch)
      recorder.clearRecording()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Could not issue a new challenge phrase.')
    }
  }

  const handleSubmit = async () => {
    if (!session || !challenge || !recorder.recording) return
    setError(null)
    setSubmitting(true)

    setStages([
      { id: 'upload', label: 'Voice recording received', state: 'processing', detail: 'Uploading encrypted audio...' },
      { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'waiting' },
      { id: 'eidos', label: 'Matching enrolled speaker — Eidos', state: 'waiting' },
      { id: 'phrase', label: 'Validating security phrase', state: 'waiting' },
      { id: 'policy', label: 'Evaluating security policy', state: 'waiting' },
      { id: 'decision', label: 'Finalizing authorization decision', state: 'waiting' },
    ])

    try {
      const fd = new FormData()
      fd.append('challenge_id', challenge.id)
      fd.append('file', recorder.recording.file)

      const res = await api.verifySessionAudioWithProgress(session.id, fd, () => {
        setStages([
          { id: 'upload', label: 'Voice recording received', state: 'completed' },
          { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'processing' },
          { id: 'eidos', label: 'Matching enrolled speaker — Eidos', state: 'processing' },
          { id: 'phrase', label: 'Validating security phrase', state: 'processing' },
          { id: 'policy', label: 'Evaluating security policy', state: 'waiting' },
          { id: 'decision', label: 'Finalizing authorization decision', state: 'waiting' },
        ])
      })

      const results = res.session.verification_results
      const aletheiaItem = results.find((r) => r.check_type === 'voice_authenticity')
      const eidosItem = results.find((r) => r.check_type === 'speaker_verification')
      const phraseItem = results.find(
        (r) => r.check_type === 'challenge_phrase' || r.check_type === 'challenge_validation',
      )

      const mapCheckState = (r?: { normalized_result: string }) => {
        if (!r) return 'completed' as const
        if (['REAL', 'MATCH'].includes(r.normalized_result)) return 'completed' as const
        if (['PROVIDER_ERROR', 'TRANSCRIPTION_ERROR', 'ENROLLMENT_MISSING'].includes(r.normalized_result)) {
          return 'review' as const
        }
        return 'failed' as const
      }

      const outcome = res.decision.outcome
      const finalStageState =
        outcome === 'PASS' ? 'completed' : outcome === 'REJECT' ? 'failed' : 'review'

      setStages([
        { id: 'upload', label: 'Voice recording received', state: 'completed' },
        {
          id: 'aletheia',
          label: 'Checking voice authenticity — Aletheia',
          state: mapCheckState(aletheiaItem),
          detail: aletheiaItem ? `${aletheiaItem.normalized_result} (${aletheiaItem.provider_mode})` : 'Not required',
        },
        {
          id: 'eidos',
          label: 'Matching enrolled speaker — Eidos',
          state: mapCheckState(eidosItem),
          detail: eidosItem ? `${eidosItem.normalized_result} (${eidosItem.provider_mode})` : 'Not required',
        },
        {
          id: 'phrase',
          label: 'Validating security phrase',
          state: mapCheckState(phraseItem),
          detail: phraseItem ? phraseItem.normalized_result : 'Completed',
        },
        {
          id: 'policy',
          label: 'Evaluating security policy',
          state: 'completed',
          detail: `${res.decision.policy_id} v${res.decision.policy_version}`,
        },
        {
          id: 'decision',
          label: 'Finalizing authorization decision',
          state: finalStageState,
          detail: `Outcome: ${outcome}`,
        },
      ])

      setSession(res.session)
      if (res.session.latest_challenge) setChallenge(res.session.latest_challenge)
      setVerifyResponse(res)
      sessionStorage.removeItem(storageKey)
      onVerified(res)
    } catch (err: unknown) {
      const message = err instanceof ApiClientError ? err.message : 'Verification request failed.'
      setError(message)
      setStages([
        { id: 'upload', label: 'Voice recording received', state: 'failed', detail: message },
        { id: 'aletheia', label: 'Checking voice authenticity — Aletheia', state: 'waiting' },
        { id: 'eidos', label: 'Matching enrolled speaker — Eidos', state: 'waiting' },
        { id: 'phrase', label: 'Validating security phrase', state: 'waiting' },
        { id: 'policy', label: 'Evaluating security policy', state: 'waiting' },
        { id: 'decision', label: 'Finalizing authorization decision', state: 'failed' },
      ])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="vl-surface rounded-2xl overflow-hidden">
      {/* Minimal Header */}
      <div className="px-5 sm:px-6 py-4 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-3 bg-white">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-zinc-950 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">VoiceLock Verification</h2>
            <p className="text-xs text-zinc-500">
              Confirm you are the authorized account holder to continue.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
          <Lock className="h-3 w-3 text-zinc-500" aria-hidden="true" />
          Action-Bound
        </span>
      </div>

      <div className="p-5 sm:p-6 space-y-5">
        {/* Quiet Hairline Context Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200/70 rounded-xl border border-zinc-200/70 bg-zinc-50/70 text-xs">
          <div className="p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Operation</div>
            <div className="font-semibold text-zinc-950 mt-0.5">{actionLabel}</div>
          </div>
          <div className="p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Account</div>
            <div className="font-semibold text-zinc-950 mt-0.5 truncate">{maskedAccountDisplay}</div>
          </div>
          <div className="p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Status</div>
            <div className="font-semibold text-zinc-950 mt-0.5">
              {verifyResponse
                ? verifyResponse.decision.outcome
                : submitting
                  ? 'Verifying audio...'
                  : initializing
                    ? 'Preparing...'
                    : 'Awaiting voice phrase'}
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 flex items-start gap-2 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {initializing ? (
          <div className="py-10 text-center text-sm text-zinc-500">
            Preparing fresh challenge and security session...
          </div>
        ) : (
          <>
            {challenge && !verifyResponse && (
              <VoiceChallengeCard
                challenge={challenge}
                secondsLeft={secondsLeft}
                disabled={submitting}
                onRefresh={() => void handleRefreshChallenge()}
              />
            )}

            {challenge && !verifyResponse && (
              <VoiceRecorder
                minDurationSeconds={requireEidos ? 3 : 2}
                maxDurationSeconds={requireEidos ? 60 : 300}
                isRecording={recorder.isRecording}
                elapsedSeconds={recorder.elapsedSeconds}
                audioLevel={recorder.audioLevel}
                recording={recorder.recording}
                recorderError={recorder.recorderError}
                onStart={() => void recorder.startRecording()}
                onStop={recorder.stopRecording}
                onRetake={recorder.clearRecording}
                onUploadFile={(f) => void recorder.setUploadedFile(f)}
                onSubmit={() => void handleSubmit()}
                submitting={submitting}
                disabled={secondsLeft <= 0 && challenge.status === 'ISSUED'}
              />
            )}

            {(submitting || verifyResponse) && <VerificationProgress stages={stages} />}

            {verifyResponse && (
              <VerificationResult
                response={verifyResponse}
                actionLabel={actionLabel}
                maskedAccountDisplay={maskedAccountDisplay}
                attackSimulationMode={attackSimulationMode}
                onContinueAction={
                  onContinueAction ? () => onContinueAction(verifyResponse) : undefined
                }
                onRetryVerification={() => void startFreshSession()}
                continuing={continuing}
              />
            )}
          </>
        )}

        {onCancel && !verifyResponse && (
          <div className="pt-1 flex justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                sessionStorage.removeItem(storageKey)
                if (session) {
                  void api.cancelSession(session.id).catch(() => {})
                }
                onCancel()
              }}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-950 transition-colors"
            >
              Cancel Verification
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
