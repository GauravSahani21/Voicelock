import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Landmark,
  ArrowLeft,
  Phone,
  KeyRound,
  UserPlus,
  LifeBuoy,
  Eye,
  CheckCircle2,
  Mic,
  AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLivePolling } from '../../hooks/useLivePolling'
import { api, ApiClientError } from '../../services/api'
import { VoiceLockVerification } from '../../components/voicelock/VoiceLockVerification'
import { QuickEnrollModal } from '../../components/voicelock/QuickEnrollModal'
import { RegisterUserModal } from '../../components/voicelock/RegisterUserModal'
import type { EndUser, IndustryActionRecord, Tenant, VerifySubmissionResponse } from '../../types'

const BANK_ACTIONS = [
  {
    action: 'change_registered_phone',
    label: 'Change Registered Mobile Number',
    description: 'Update SMS OTP & fraud alert mobile number.',
    icon: Phone,
    primary: true,
    requireEidos: true,
  },
  {
    action: 'reset_account_credentials',
    label: 'Reset Account Credentials',
    description: 'Reset online banking password and telephone PIN.',
    icon: KeyRound,
    primary: false,
    requireEidos: true,
  },
  {
    action: 'add_beneficiary',
    label: 'Add Beneficiary',
    description: 'Register an external wire/ACH payee.',
    icon: UserPlus,
    primary: false,
    requireEidos: true,
  },
  {
    action: 'account_recovery',
    label: 'Account Recovery',
    description: 'Recover a locked online banking account.',
    icon: LifeBuoy,
    primary: false,
    requireEidos: true,
  },
  {
    action: 'view_account_details',
    label: 'View Sensitive Account Information',
    description: 'Reveal full statements & routing numbers (Eidos + Challenge).',
    icon: Eye,
    primary: false,
    requireEidos: true,
  },
]

export function BankingPortal() {
  const { ensureDemoSession } = useAuth()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [users, setUsers] = useState<EndUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [executions, setExecutions] = useState<IndustryActionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeAction, setActiveAction] = useState<(typeof BANK_ACTIONS)[number] | null>(null)
  const [newPhone, setNewPhone] = useState('+1-555-0999')
  const [requestRef, setRequestRef] = useState('')
  const [confirmedRecord, setConfirmedRecord] = useState<IndustryActionRecord | null>(null)
  const [executing, setExecuting] = useState(false)
  const [enrollModalOpen, setEnrollModalOpen] = useState(false)
  const [registerModalOpen, setRegisterModalOpen] = useState(false)

  const loadPortal = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const tenantList = await ensureDemoSession('admin')
        const bank = tenantList.find((t) => t.industry === 'banking')
        if (!bank) {
          setError('Demo Bank tenant not found.')
          setLoading(false)
          return
        }
        setTenant(bank)
        const [uList, execs] = await Promise.all([
          api.listTenantUsers(bank.id),
          api.listWorkflowExecutions(bank.id, 'banking'),
        ])
        setUsers(uList)
        setSelectedUserId((prev) => prev || uList[0]?.id || '')
        setExecutions(execs)
        if (!silent) setError(null)
      } catch (err: unknown) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Unable to load Banking Portal')
        }
      } finally {
        setLoading(false)
      }
    },
    [ensureDemoSession],
  )

  useEffect(() => {
    void loadPortal(false)
  }, [loadPortal])

  useLivePolling(
    () => {
      void loadPortal(true)
    },
    { intervalMs: 6000, enabled: !activeAction },
  )

  const customer = users.find((u) => u.id === selectedUserId) ?? users[0] ?? null
  const meta = (customer?.metadata_json ?? {}) as Record<string, unknown>

  const startAction = (act: (typeof BANK_ACTIONS)[number]) => {
    setActiveAction(act)
    setRequestRef(`BNK-${Date.now().toString().slice(-6)}`)
    setConfirmedRecord(null)
    setError(null)
  }

  const handleContinue = async (res: VerifySubmissionResponse) => {
    if (!tenant || !customer || !activeAction || !res.authorization_token) return
    setExecuting(true)
    try {
      const rec = await api.executeWorkflowAction('banking', {
        tenant_id: tenant.id,
        user_id: customer.id,
        action: activeAction.action,
        resource_reference: requestRef,
        authorization_token: res.authorization_token,
        operation_payload:
          activeAction.action === 'change_registered_phone' ? { new_phone: newPhone } : {},
      })
      setConfirmedRecord(rec)
      await loadPortal()
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'Banking operation failed')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-950 flex flex-col">
      {/* Minimal Frosted Header */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-zinc-200/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-16 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-950 pr-2.5 border-r border-zinc-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Demo Hub</span>
            </Link>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
                <Landmark className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-950 truncate">Crestline Digital Bank</div>
                <div className="text-[11px] text-zinc-500 truncate">Personal Banking &amp; Security</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            {users.length > 0 && (
              <select
                aria-label="Select demo bank customer"
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value)
                  setActiveAction(null)
                }}
                className="min-w-0 max-w-[165px] sm:max-w-none rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={!tenant}
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 shrink-0 transition-colors disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Register</span>
            </button>
            {customer && (
              <button
                type="button"
                onClick={() => setEnrollModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 shrink-0 transition-colors"
              >
                <Mic className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                <span>{customer.enrollment_status === 'enrolled' ? 'Re-Enroll Voice' : 'Enroll Demo Voice (15s)'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="vl-surface rounded-2xl p-12 text-center text-sm text-zinc-500">
            Loading Crestline Bank portal...
          </div>
        ) : customer ? (
          <>
            {!activeAction ? (
              <div className="space-y-6">
                <div className="vl-surface rounded-2xl p-6 sm:p-7 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      Bank Customer · <span className="font-mono">{customer.external_reference}</span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                      {customer.name.split(' (')[0]}
                    </h1>
                    <p className="text-sm text-zinc-500 vl-nums">
                      Account {String(meta.account_mask ?? '••••-8821')} · {String(meta.account_type ?? 'Premier Checking')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startAction(BANK_ACTIONS[0])}
                    className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                  >
                    Change Registered Mobile Number
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-sm">
                  <BankTile label="Masked Account" value={String(meta.account_mask ?? '••••-8821')} />
                  <BankTile label="Account Type" value={String(meta.account_type ?? 'Premier Checking')} />
                  <BankTile label="Account Status" value="Active · Verified" />
                  <BankTile label="Registered Mobile" value={String(meta.masked_phone ?? customer.phone_reference)} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {BANK_ACTIONS.map((item) => {
                    const Icon = item.icon
                    return (
                      <div key={item.action} className="vl-surface-interactive rounded-2xl p-5 flex flex-col justify-between gap-4">
                        <div className="space-y-2.5">
                          <div className="h-9 w-9 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center">
                            <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                          </div>
                          <div>
                            <h2 className="text-sm font-semibold text-zinc-950">{item.label}</h2>
                            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{item.description}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => startAction(item)}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors"
                        >
                          Continue
                        </button>
                      </div>
                    )
                  })}
                </div>

                {executions.length > 0 && (
                  <div className="vl-surface rounded-2xl p-6 space-y-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Recent Banking Operations
                    </h3>
                    <ul className="divide-y divide-zinc-100 text-xs">
                      {executions.map((ex) => (
                        <li key={ex.id} className="py-2.5 text-zinc-700 first:pt-1 last:pb-0">
                          {ex.summary}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="vl-surface rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-zinc-500 font-mono">Banking Request {requestRef}</div>
                    <div className="text-base font-semibold text-zinc-950 mt-0.5">{activeAction.label}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveAction(null)}
                    className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Back to Banking Dashboard
                  </button>
                </div>

                {activeAction.action === 'change_registered_phone' && !confirmedRecord && (
                  <div className="vl-surface rounded-2xl p-5">
                    <label htmlFor="bank-new-phone" className="block text-xs font-medium text-zinc-700 mb-1.5">
                      New Mobile Number to Register
                    </label>
                    <input
                      id="bank-new-phone"
                      type="tel"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm font-mono text-zinc-900"
                    />
                  </div>
                )}

                {!confirmedRecord && tenant ? (
                  <VoiceLockVerification
                    tenantId={tenant.id}
                    userId={customer.id}
                    action={activeAction.action}
                    actionLabel={activeAction.label}
                    resourceReference={requestRef}
                    maskedAccountDisplay={`${String(meta.account_mask ?? '••••-8821')} · ${String(meta.masked_phone ?? '')}`}
                    requireEidos={activeAction.requireEidos}
                    onVerified={() => void loadPortal(true)}
                    onContinueAction={(res) => void handleContinue(res)}
                    continuing={executing}
                    onCancel={() => setActiveAction(null)}
                  />
                ) : confirmedRecord ? (
                  <div className="vl-surface rounded-2xl border-emerald-200 p-6 space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <h2 className="text-lg font-semibold text-zinc-950">{activeAction.label} Completed</h2>
                        <p className="text-sm text-zinc-600 mt-1">{confirmedRecord.summary}</p>
                      </div>
                    </div>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActiveAction(null)}
                        className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-medium text-white"
                      >
                        Return to Account
                      </button>
                      <Link
                        to={`/security/decisions/${confirmedRecord.session_id}`}
                        className="rounded-full border border-zinc-200 bg-white px-5 py-2 text-xs font-medium text-zinc-700"
                      >
                        Inspect in Security Dashboard
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </main>

      {tenant && customer && (
        <QuickEnrollModal
          open={enrollModalOpen}
          tenantId={tenant.id}
          userId={customer.id}
          userName={customer.name}
          onEnrolled={() => void loadPortal(true)}
          onClose={() => setEnrollModalOpen(false)}
        />
      )}

      {tenant && (
        <RegisterUserModal
          open={registerModalOpen}
          tenantId={tenant.id}
          tenantName={tenant.name}
          industry="banking"
          onRegistered={(user) => {
            setSelectedUserId(user.id)
            setActiveAction(null)
            void loadPortal(true)
          }}
          onClose={() => setRegisterModalOpen(false)}
        />
      )}
    </div>
  )
}

function BankTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="vl-surface rounded-2xl p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-950 mt-1.5 vl-nums">{value}</div>
    </div>
  )
}
