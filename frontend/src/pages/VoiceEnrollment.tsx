import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, Trash2, AlertCircle, CheckCircle2, Info, RefreshCw, UserPlus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLivePolling } from '../hooks/useLivePolling'
import { api, ApiClientError } from '../services/api'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { AudioRecorderPanel } from '../components/audio/AudioRecorderPanel'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { RegisterUserModal } from '../components/voicelock/RegisterUserModal'
import { ProvenanceBadge } from '../components/ui/Badges'
import type { EndUser, Enrollment } from '../types'

export function VoiceEnrollment() {
  const { selectedTenantId, tenants } = useAuth()
  const [formTenantId, setFormTenantId] = useState('')
  const targetTenantId = selectedTenantId || formTenantId || tenants[0]?.id || ''

  const [users, setUsers] = useState<EndUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [reEnroll, setReEnroll] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<Enrollment | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [registerModalOpen, setRegisterModalOpen] = useState(false)
  const activeFormTenant = tenants.find((t) => t.id === targetTenantId) ?? null

  const recorder = useAudioRecorder()

  useEffect(() => {
    if (!formTenantId && tenants.length > 0) {
      setFormTenantId(tenants[0].id)
    }
  }, [tenants, formTenantId])

  const loadData = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true)
      try {
        const listScopeTenant = selectedTenantId || undefined
        const [enrollmentList, userList] = await Promise.all([
          api.listEnrollments(listScopeTenant),
          targetTenantId ? api.listTenantUsers(targetTenantId) : Promise.resolve([]),
        ])
        setEnrollments(enrollmentList)
        setUsers(userList)
        if (userList.length > 0 && !userList.some((u) => u.id === selectedUserId)) {
          setSelectedUserId(userList[0].id)
        }
      } catch (err: unknown) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Failed to load enrollment data')
        }
      } finally {
        setRefreshing(false)
      }
    },
    [selectedTenantId, targetTenantId, selectedUserId],
  )

  useEffect(() => {
    void loadData(false)
  }, [loadData])

  useLivePolling(
    () => {
      void loadData(true)
    },
    { intervalMs: 5000, enabled: true },
  )

  const handleEnrollSubmit = async () => {
    if (!targetTenantId || !selectedUserId || !recorder.recording || !consentConfirmed) return
    setError(null)
    setSuccessMsg(null)
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('tenant_id', targetTenantId)
      fd.append('user_id', selectedUserId)
      fd.append('consent_confirmed', String(consentConfirmed))
      fd.append('re_enroll', String(reEnroll))
      fd.append('file', recorder.recording.file)

      const res = await api.enrollSpeaker(fd)
      setSuccessMsg(
        `Voice profile enrolled for ${res.user_name} (${res.sample_count}/5 samples, mode: ${res.provider_mode}).`,
      )
      recorder.clearRecording()
      setConsentConfirmed(false)
      setReEnroll(false)
      await loadData(true)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Enrollment failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setError(null)
    try {
      await api.revokeEnrollment(revokeTarget.id)
      setSuccessMsg(`Revoked speaker profile for ${revokeTarget.user_name}.`)
      setRevokeTarget(null)
      await loadData(true)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to revoke enrollment')
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">Voice Enrollment (Detectif.ai Eidos)</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Enroll speaker voiceprints with explicit user consent (15–60s audio, 10s+ clear speech).
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadData(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Privacy & Data Handling Disclosure */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 flex items-start gap-3 text-xs text-zinc-600">
        <Info className="h-4 w-4 text-zinc-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <div className="font-semibold text-zinc-950">Voice Biometrics &amp; Privacy Disclosure</div>
          <p>
            VoiceLock does not retain raw audio locally—temp files are deleted unconditionally after processing,
            and no embeddings are stored locally. In Detectif.ai live mode, encrypted Eidos profiles persist until
            revoked via <code>DELETE /v1/speakers/&#123;speaker_id&#125;</code>.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-2 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Enrollment Form */}
        <div className="lg:col-span-6 vl-surface rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-950">Enroll Speaker Voice Sample</h2>

          {!selectedTenantId && tenants.length > 0 && (
            <div>
              <label htmlFor="enroll-tenant" className="block text-xs font-medium text-zinc-700 mb-1">
                Target Tenant
              </label>
              <select
                id="enroll-tenant"
                value={targetTenantId}
                onChange={(e) => {
                  setFormTenantId(e.target.value)
                  setSelectedUserId('')
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
          )}

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor="enroll-user" className="block text-xs font-medium text-zinc-700">
                Select User
              </label>
              <button
                type="button"
                disabled={!activeFormTenant}
                onClick={() => setRegisterModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 hover:text-zinc-950 disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Register New User</span>
              </button>
            </div>
            <select
              id="enroll-user"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.external_reference}) — {u.enrollment_status ?? 'not_enrolled'}
                </option>
              ))}
            </select>
          </div>

          <AudioRecorderPanel
            title="Capture 15–60s Enrollment Sample"
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

          <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 space-y-2">
            <label className="flex items-start gap-2.5 text-xs text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-zinc-300 text-zinc-950"
              />
              <span>
                <strong>Explicit Consent Confirmed:</strong> User explicitly consents to creating an Eidos voiceprint
                profile and understands they may revoke it at any time.
              </span>
            </label>
            <label className="flex items-center gap-2.5 text-xs text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={reEnroll}
                onChange={(e) => setReEnroll(e.target.checked)}
                className="rounded border-zinc-300 text-zinc-950"
              />
              <span>Replace existing enrolled profile (revokes prior voiceprint first)</span>
            </label>
          </div>

          <button
            type="button"
            disabled={!consentConfirmed || !recorder.recording || recorder.isRecording || submitting}
            onClick={() => void handleEnrollSubmit()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>{submitting ? 'Submitting Enrollment...' : 'Enroll Voice Profile'}</span>
          </button>
        </div>

        {/* Enrolled Profiles List */}
        <div className="lg:col-span-6 vl-surface rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-950">
              Enrolled Profiles {!selectedTenantId ? '(All Tenants)' : ''}
            </h2>
            <span className="text-xs text-zinc-500 vl-nums">{enrollments.length} records</span>
          </div>

          {enrollments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
              No voice enrollments yet. Record or upload a 15–60s sample to enroll a user.
            </div>
          ) : (
            <div className="space-y-3">
              {enrollments.map((enr) => (
                <div key={enr.id} className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-zinc-950">{enr.user_name}</div>
                      <div className="text-xs font-mono text-zinc-500">
                        {enr.user_external_reference}
                        {enr.tenant_name ? ` · ${enr.tenant_name}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProvenanceBadge mode={enr.provider_mode} />
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase ${
                          enr.enrollment_status === 'enrolled'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                        }`}
                      >
                        {enr.enrollment_status}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 pt-1">
                    <div>Samples: <strong>{enr.sample_count}/5</strong></div>
                    <div>Consent: <strong className="capitalize">{enr.consent_status}</strong></div>
                    <div className="col-span-2 font-mono text-[11px] text-zinc-500 truncate">
                      Op ID: {enr.last_operation_id || 'N/A'}
                    </div>
                  </div>
                  {enr.enrollment_status === 'enrolled' && (
                    <div className="pt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(enr)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Revoke &amp; Delete Voiceprint</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke Voice Enrollment?"
        description={`This will permanently revoke and delete the Eidos voice profile for ${
          revokeTarget?.user_name ?? 'this user'
        }. Subsequent voice verifications requiring Eidos will trigger STEP_UP until re-enrolled.`}
        confirmLabel="Revoke & Delete"
        busy={revoking}
        onConfirm={() => void handleConfirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />

      {activeFormTenant && (
        <RegisterUserModal
          open={registerModalOpen}
          tenantId={activeFormTenant.id}
          tenantName={activeFormTenant.name}
          industry={activeFormTenant.industry}
          onRegistered={(user) => {
            setSelectedUserId(user.id)
            setSuccessMsg(`Registered ${user.name} (${user.external_reference}).`)
            void loadData(true)
          }}
          onClose={() => setRegisterModalOpen(false)}
        />
      )}
    </div>
  )
}
