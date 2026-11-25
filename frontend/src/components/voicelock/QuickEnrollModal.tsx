import { useEffect, useId, useRef, useState } from 'react'
import { Mic, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import { api, ApiClientError } from '../../services/api'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { AudioRecorderPanel } from '../audio/AudioRecorderPanel'

interface QuickEnrollModalProps {
  open: boolean
  tenantId: string
  userId: string
  userName: string
  onEnrolled: () => void
  onClose: () => void
}

export function QuickEnrollModal({
  open,
  tenantId,
  userId,
  userName,
  onEnrolled,
  onClose,
}: QuickEnrollModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const recorder = useAudioRecorder()
  const [consent, setConsent] = useState(true)
  const [reEnroll, setReEnroll] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setError(null)
      setDoneMsg(null)
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const handleSubmit = async () => {
    if (!recorder.recording || !consent) return
    setSubmitting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('tenant_id', tenantId)
      fd.append('user_id', userId)
      fd.append('consent_confirmed', 'true')
      fd.append('re_enroll', String(reEnroll))
      fd.append('file', recorder.recording.file)
      const res = await api.enrollSpeaker(fd)
      setDoneMsg(`Enrolled ${res.user_name} (${res.sample_count}/5 samples, ${res.provider_mode}).`)
      recorder.clearRecording()
      onEnrolled()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Enrollment failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = ''
        onClose()
      }}
      className="m-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-0 shadow-2xl"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-zinc-950 text-white flex items-center justify-center shrink-0">
              <Mic className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h1 id={titleId} className="text-base font-semibold text-zinc-950">
                Enroll Voice for {userName}
              </h1>
              <p className="text-xs text-zinc-500">
                Speak naturally for 15–20 seconds (Detectif.ai Eidos minimum 15s, 10s+ speech).
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <AudioRecorderPanel
          title="Voice Enrollment Capture"
          minDurationSeconds={15}
          maxDurationSeconds={60}
          recommendedSeconds={18}
          isRecording={recorder.isRecording}
          elapsedSeconds={recorder.elapsedSeconds}
          audioLevel={recorder.audioLevel}
          recording={recorder.recording}
          recorderError={recorder.recorderError}
          onStart={() => void recorder.startRecording()}
          onStop={recorder.stopRecording}
          onRetake={recorder.clearRecording}
          onUploadFile={(f) => void recorder.setUploadedFile(f)}
          disabled={submitting}
        />

        <div className="space-y-2 text-xs text-zinc-700">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 rounded border-zinc-300 text-zinc-950"
            />
            <span>Explicit user consent confirmed for voice verification enrollment.</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={reEnroll}
              onChange={(e) => setReEnroll(e.target.checked)}
              className="rounded border-zinc-300 text-zinc-950"
            />
            <span>Replace any previous enrollment for this demo account</span>
          </label>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {doneMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{doneMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!consent || !recorder.recording || recorder.isRecording || submitting}
            onClick={() => void handleSubmit()}
            className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? 'Enrolling...' : 'Save Voiceprint'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
