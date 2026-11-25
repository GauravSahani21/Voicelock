import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { UserPlus, X, AlertCircle, CheckCircle2, Mic } from 'lucide-react'
import { api, ApiClientError } from '../../services/api'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { AudioRecorderPanel } from '../audio/AudioRecorderPanel'
import type { EndUser, IndustryType } from '../../types'

interface RegisterUserModalProps {
  open: boolean
  tenantId: string
  tenantName: string
  industry: IndustryType
  onRegistered: (user: EndUser) => void
  onClose: () => void
}

const ROLE_OPTIONS_BY_INDUSTRY: Record<IndustryType, { value: string; label: string }[]> = {
  telecom: [{ value: 'customer', label: 'Customer' }],
  helpdesk: [{ value: 'employee', label: 'Employee' }],
  banking: [{ value: 'customer', label: 'Bank Customer' }],
  education: [
    { value: 'student', label: 'Student' },
    { value: 'faculty', label: 'Faculty' },
    { value: 'administrator', label: 'Administrator' },
  ],
}

export function RegisterUserModal({
  open,
  tenantId,
  tenantName,
  industry,
  onRegistered,
  onClose,
}: RegisterUserModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const titleId = useId()
  const refHelpId = useId()
  const voicePanelId = useId()
  const nameInputId = useId()
  const emailInputId = useId()
  const phoneInputId = useId()
  const refInputId = useId()
  const extraInputId = useId()

  const recorder = useAudioRecorder()
  const roleOptions = ROLE_OPTIONS_BY_INDUSTRY[industry]

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [role, setRole] = useState(roleOptions[0]?.value ?? 'customer')
  const [extraField, setExtraField] = useState('')

  const [enrollVoiceNow, setEnrollVoiceNow] = useState(false)
  const [voiceConsent, setVoiceConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUser, setCreatedUser] = useState<EndUser | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setName('')
      setEmail('')
      setPhone('')
      setExternalRef('')
      setRole(ROLE_OPTIONS_BY_INDUSTRY[industry][0]?.value ?? 'customer')
      setExtraField('')
      setEnrollVoiceNow(false)
      setVoiceConsent(false)
      setError(null)
      setCreatedUser(null)
      recorder.clearRecording()
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, industry])

  const extraLabel =
    industry === 'telecom'
      ? 'Primary Device Model'
      : industry === 'helpdesk'
        ? 'Department'
        : industry === 'banking'
          ? 'Account Type'
          : 'Academic Department'

  const extraPlaceholder =
    industry === 'telecom'
      ? 'e.g. Apple iPhone 16 Pro'
      : industry === 'helpdesk'
        ? 'e.g. Platform Security'
        : industry === 'banking'
          ? 'e.g. Premier Checking'
          : 'e.g. Computer Science'

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    const form = formRef.current
    if (form && !form.checkValidity()) {
      const firstInvalid = form.querySelector<HTMLElement>(':invalid')
      firstInvalid?.focus()
      form.reportValidity()
      return
    }

    if (enrollVoiceNow) {
      if (!recorder.recording) {
        setError('Please record or upload a 15–60 second voice sample, or uncheck voice enrollment.')
        return
      }
      if (!voiceConsent) {
        setError('Please confirm explicit biometric voice enrollment consent.')
        return
      }
    }

    setSubmitting(true)
    let userRecord = createdUser
    try {
      if (!userRecord) {
        const metadata: Record<string, unknown> = {}
        if (extraField.trim()) {
          if (industry === 'telecom') metadata.registered_device = extraField.trim()
          else if (industry === 'banking') metadata.account_type = extraField.trim()
          else metadata.department = extraField.trim()
        }

        userRecord = await api.createTenantUser(tenantId, {
          name: name.trim(),
          email: email.trim() || undefined,
          phone_reference: phone.trim() || undefined,
          external_reference: externalRef.trim() || undefined,
          role,
          metadata_json: metadata,
        })
        setCreatedUser(userRecord)
      }

      if (enrollVoiceNow && recorder.recording) {
        const fd = new FormData()
        fd.append('tenant_id', tenantId)
        fd.append('user_id', userRecord.id)
        fd.append('consent_confirmed', 'true')
        fd.append('re_enroll', 'false')
        fd.append('file', recorder.recording.file)
        await api.enrollSpeaker(fd)
        userRecord = { ...userRecord, enrollment_status: 'enrolled' }
      }

      onRegistered(userRecord)
      onClose()
    } catch (err: unknown) {
      if (userRecord && enrollVoiceNow) {
        setError(
          `User "${userRecord.name}" was created (${userRecord.external_reference}), but voice enrollment failed: ${
            err instanceof ApiClientError ? err.message : 'Please upload a 15–60s clear speech sample or finish without voice.'
          }`,
        )
        onRegistered(userRecord)
      } else {
        setError(err instanceof ApiClientError ? err.message : 'Unable to register user.')
      }
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
      className="m-auto w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 shadow-2xl"
    >
      <form
        ref={formRef}
        method="POST"
        onSubmit={(e) => void handleSubmit(e)}
        className="p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-zinc-950 text-white flex items-center justify-center shrink-0">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h1 id={titleId} className="text-base font-semibold text-zinc-950">
                Register New User
              </h1>
              <p className="text-xs text-zinc-500">
                {tenantName} · {industry} portal identity
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close registration modal"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="field">
            <label htmlFor={nameInputId} className="block text-xs font-medium text-zinc-700 mb-1">
              Full Name <span aria-hidden="true" className="text-rose-600">*</span>
            </label>
            <input
              id={nameInputId}
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={160}
              autoFocus
              autoComplete="name"
              enterKeyHint="next"
              value={name}
              disabled={Boolean(createdUser)}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gaurav Sahani"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-950 disabled:bg-zinc-100"
            />
            <div className="field-error-msg">Please enter at least 2 characters for full name.</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="field">
              <label htmlFor={emailInputId} className="block text-xs font-medium text-zinc-700 mb-1">
                Email Address
              </label>
              <input
                id={emailInputId}
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                value={email}
                disabled={Boolean(createdUser)}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-950 disabled:bg-zinc-100"
              />
              <div className="field-error-msg">Enter a valid email address.</div>
            </div>

            <div className="field">
              <label htmlFor={phoneInputId} className="block text-xs font-medium text-zinc-700 mb-1">
                Mobile Phone
              </label>
              <input
                id={phoneInputId}
                name="phone_reference"
                type="tel"
                autoComplete="tel"
                enterKeyHint="next"
                value={phone}
                disabled={Boolean(createdUser)}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1-555-0199"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm font-mono text-zinc-950 disabled:bg-zinc-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="field">
              <label htmlFor={refInputId} className="block text-xs font-medium text-zinc-700 mb-1">
                Account / Reference ID
              </label>
              <input
                id={refInputId}
                name="external_reference"
                type="text"
                minLength={2}
                maxLength={128}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={refHelpId}
                enterKeyHint="next"
                value={externalRef}
                disabled={Boolean(createdUser)}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder="Auto-generated if blank"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm font-mono text-zinc-950 disabled:bg-zinc-100"
              />
              <span id={refHelpId} className="block text-[11px] text-zinc-500 mt-1">
                Optional unique ID; leaves clean prefix if omitted.
              </span>
            </div>

            <div className="field">
              <label htmlFor={extraInputId} className="block text-xs font-medium text-zinc-700 mb-1">
                {extraLabel}
              </label>
              <input
                id={extraInputId}
                name="profile_detail"
                type="text"
                enterKeyHint="done"
                value={extraField}
                disabled={Boolean(createdUser)}
                onChange={(e) => setExtraField(e.target.value)}
                placeholder={extraPlaceholder}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-950 disabled:bg-zinc-100"
              />
            </div>
          </div>

          {roleOptions.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-zinc-700">Portal Role</legend>
              <div className="flex flex-wrap gap-3 pt-1">
                {roleOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-xs font-medium text-zinc-800 cursor-pointer has-[:checked]:border-zinc-950 has-[:checked]:bg-zinc-950 has-[:checked]:text-white transition-colors"
                  >
                    <input
                      type="radio"
                      name="role"
                      value={opt.value}
                      checked={role === opt.value}
                      disabled={Boolean(createdUser)}
                      onChange={() => setRole(opt.value)}
                      className="sr-only"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        {/* Optional Live Voice Enrollment */}
        <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="flex items-center gap-2 text-xs font-medium text-zinc-900">
              <Mic className="h-3.5 w-3.5 text-zinc-700" aria-hidden="true" />
              <span>Also enroll 15s VoiceLock voiceprint now (optional)</span>
            </span>
            <input
              type="checkbox"
              name="enroll_voice_now"
              aria-expanded={enrollVoiceNow}
              aria-controls={voicePanelId}
              checked={enrollVoiceNow}
              onChange={(e) => setEnrollVoiceNow(e.target.checked)}
              className="rounded border-zinc-300 text-zinc-950"
            />
          </label>

          {enrollVoiceNow && (
            <div id={voicePanelId} className="space-y-3 pt-1">
              <AudioRecorderPanel
                title="Voiceprint Sample (15–60s)"
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

              <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  name="voice_consent"
                  checked={voiceConsent}
                  onChange={(e) => setVoiceConsent(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 text-zinc-950"
                />
                <span>Explicit user consent confirmed for voiceprint enrollment.</span>
              </label>
            </div>
          )}
        </div>

        <div aria-live="polite">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {createdUser && !error && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Account created ({createdUser.external_reference}).</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || recorder.isRecording}
            className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting
              ? enrollVoiceNow
                ? 'Registering & Enrolling...'
                : 'Creating Account...'
              : enrollVoiceNow
                ? 'Create Account & Enroll Voice'
                : 'Create User Account'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
