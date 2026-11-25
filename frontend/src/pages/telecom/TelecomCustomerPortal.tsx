import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Smartphone,
  Shield,
  LayoutGrid,
  FileText,
  History,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Swords,
  Mic,
  ArrowLeft,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLivePolling } from '../../hooks/useLivePolling'
import { api, ApiClientError } from '../../services/api'
import { VoiceLockVerification } from '../../components/voicelock/VoiceLockVerification'
import { QuickEnrollModal } from '../../components/voicelock/QuickEnrollModal'
import { RegisterUserModal } from '../../components/voicelock/RegisterUserModal'
import type { EndUser, IndustryActionRecord, SessionDetail, Tenant, VerifySubmissionResponse } from '../../types'

type TelecomNav = 'overview' | 'sim' | 'security' | 'requests' | 'activity'

export function TelecomCustomerPortal() {
  const { ensureDemoSession } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAttackMode = searchParams.get('mode') === 'attack'

  const [nav, setNav] = useState<TelecomNav>(isAttackMode ? 'sim' : 'overview')
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [users, setUsers] = useState<EndUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [executions, setExecutions] = useState<IndustryActionRecord[]>([])
  const [userSessions, setUserSessions] = useState<SessionDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [flowStep, setFlowStep] = useState<'idle' | 'request_form' | 'verifying' | 'confirmed'>('idle')
  const [reason, setReason] = useState('Lost SIM')
  const [confirmedNumber, setConfirmedNumber] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [confirmedRecord, setConfirmedRecord] = useState<IndustryActionRecord | null>(null)
  const [lastDecisionOutcome, setLastDecisionOutcome] = useState<string | null>(null)
  const [executingOp, setExecutingOp] = useState(false)

  const [enrollModalOpen, setEnrollModalOpen] = useState(false)
  const [registerModalOpen, setRegisterModalOpen] = useState(false)

  const loadPortal = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const tenantList = await ensureDemoSession('admin')
        const tel = tenantList.find((t) => t.industry === 'telecom')
        if (!tel) {
          setError('Demo Telecom tenant not found.')
          setLoading(false)
          return
        }
        setTenant(tel)
        const [uList, execList, sessList] = await Promise.all([
          api.listTenantUsers(tel.id),
          api.listWorkflowExecutions(tel.id, 'telecom'),
          api.listSessions({ tenant_id: tel.id }),
        ])
        setUsers(uList)
        setExecutions(execList)
        setUserSessions(sessList)
        setSelectedUserId((prev) => prev || uList[0]?.id || '')
        if (!silent) setError(null)
      } catch (err: unknown) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Unable to load Telecom portal')
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
    { intervalMs: 6000, enabled: flowStep !== 'verifying' },
  )

  useEffect(() => {
    if (isAttackMode) {
      setNav('sim')
      setFlowStep('request_form')
      setConfirmedNumber(true)
      setRequestId(`SIM-ATK-${Date.now().toString().slice(-5)}`)
    }
  }, [isAttackMode])

  const customer = users.find((u) => u.id === selectedUserId) ?? users[0] ?? null
  const meta = (customer?.metadata_json ?? {}) as Record<string, unknown>
  const maskedPhone = String(meta.masked_phone ?? customer?.phone_reference ?? '+1 (555) •••-0101')
  const simStatus = String(meta.sim_status ?? 'Active')
  const simType = String(meta.sim_type ?? 'eSIM + Physical Nano-SIM')
  const lastSimUpdate = String(meta.last_sim_update ?? '2026-08-14')
  const registeredDevice = String(meta.registered_device ?? 'Apple iPhone 15 Pro')
  const currentPlan = String(meta.plan ?? '5G Unlimited Postpaid')
  const simIccid = String(meta.sim_iccid ?? '8901410321111851001')
  const customerSessions = customer
    ? userSessions.filter((s) => s.user_id === customer.id && s.decision)
    : []
  const metadataActivity = Array.isArray(meta.recent_activity)
    ? (meta.recent_activity as { date: string; event: string }[])
    : []
  const activityList: { date: string; event: string }[] = [
    ...customerSessions.slice(0, 5).map((s) => ({
      date: new Date(s.created_at).toLocaleString(),
      event: `Security check (${s.requested_action} · ${s.resource_reference}): ${s.decision?.outcome ?? s.status}`,
    })),
    ...metadataActivity,
  ]

  const openSimReplacementForm = () => {
    setNav('sim')
    setFlowStep('request_form')
    setConfirmedNumber(false)
    setConfirmedRecord(null)
    setLastDecisionOutcome(null)
    setError(null)
    setRequestId(`SIM-${Date.now().toString().slice(-6)}`)
  }

  const toggleAttackMode = (enable: boolean) => {
    setConfirmedRecord(null)
    setLastDecisionOutcome(null)
    setError(null)
    if (enable) {
      setSearchParams({ mode: 'attack' })
      setNav('sim')
      setFlowStep('request_form')
      setConfirmedNumber(true)
      setRequestId(`SIM-ATK-${Date.now().toString().slice(-5)}`)
    } else {
      setSearchParams({})
      setFlowStep('idle')
    }
  }

  const handleVerified = (res: VerifySubmissionResponse) => {
    setLastDecisionOutcome(res.decision.outcome)
    if (res.decision.outcome !== 'PASS') {
      setExecutingOp(false)
    }
    void loadPortal(true)
  }

  const handleContinueSimReplacement = async (res: VerifySubmissionResponse) => {
    if (!tenant || !customer || !res.authorization_token) return
    setExecutingOp(true)
    setError(null)
    try {
      const execRec = await api.executeWorkflowAction('telecom', {
        tenant_id: tenant.id,
        user_id: customer.id,
        action: 'sim_replacement',
        resource_reference: requestId,
        authorization_token: res.authorization_token,
        operation_payload: {
          reason,
          new_sim_iccid: `8901410321${Date.now().toString().slice(-9)}`,
        },
      })
      setConfirmedRecord(execRec)
      setFlowStep('confirmed')
      await loadPortal(true)
    } catch (err: unknown) {
      setError(err instanceof ApiClientError ? err.message : 'SIM replacement could not be completed.')
    } finally {
      setExecutingOp(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-950 flex flex-col">
      {/* Minimal Frosted Header */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-zinc-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 min-h-16 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-950 pr-2.5 border-r border-zinc-200 shrink-0 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Demo Hub</span>
            </Link>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0">
                <Smartphone className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-950 truncate">NexaCell Wireless</div>
                <div className="text-[11px] text-zinc-500 truncate">Customer Portal</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            {users.length > 0 && (
              <select
                aria-label="Demo customer account"
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value)
                  setFlowStep('idle')
                }}
                className="min-w-0 max-w-[150px] sm:max-w-none rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800"
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

            <button
              type="button"
              onClick={() => toggleAttackMode(!isAttackMode)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shrink-0 transition-colors ${
                isAttackMode
                  ? 'border-rose-600 bg-rose-600 text-white'
                  : 'border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <Swords className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {isAttackMode ? (
                  'Exit Attack Mode'
                ) : (
                  <>
                    <span className="sm:hidden">Attack Mode</span>
                    <span className="hidden sm:inline">Launch Impersonation Attempt</span>
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Attack Simulator Banner */}
      {isAttackMode && (
        <div className="bg-rose-950 text-rose-50 border-b border-rose-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Swords className="h-3.5 w-3.5 text-rose-300 shrink-0" aria-hidden="true" />
              <span>
                <strong>Attack Simulator Active:</strong> Impersonating{' '}
                <strong>{customer?.name}</strong>. Submit different speaker or synthetic audio to verify blocking.
              </span>
            </div>
            <Link to="/security" className="underline font-medium text-rose-200 hover:text-white">
              Inspect in Security Dashboard &rarr;
            </Link>
          </div>
        </div>
      )}

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Clean Minimal Rail */}
        <aside className="lg:col-span-3 space-y-5">
          <nav aria-label="Telecom customer menu" className="space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: LayoutGrid },
              { id: 'sim', label: 'My SIM', icon: Smartphone },
              { id: 'security', label: 'Account Security', icon: Shield },
              { id: 'requests', label: 'Service Requests', icon: FileText },
              { id: 'activity', label: 'Activity', icon: History },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setNav(id as TelecomNav)}
                className={`w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  nav === id
                    ? 'bg-zinc-950 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 mt-2 transition-colors"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </nav>

          {/* Compact Voice Readiness */}
          {customer && (
            <div className="vl-surface rounded-2xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-zinc-950">VoiceLock</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    customer.enrollment_status === 'enrolled'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {customer.enrollment_status === 'enrolled' ? 'Enrolled' : 'Not enrolled'}
                </span>
              </div>
              <p className="text-zinc-500 leading-relaxed">
                {customer.enrollment_status === 'enrolled'
                  ? 'Active voiceprint protects SIM transfers on this line.'
                  : 'Enroll a 15s voice sample to test legitimate & attack flows.'}
              </p>
              <button
                type="button"
                onClick={() => setEnrollModalOpen(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-800 hover:bg-zinc-50 transition-colors"
              >
                <Mic className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                <span>{customer.enrollment_status === 'enrolled' ? 'Re-Enroll Voice' : 'Enroll Demo Voice (15s)'}</span>
              </button>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="lg:col-span-9 space-y-6">
          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="vl-surface rounded-2xl p-12 text-center text-sm text-zinc-500">
              Loading NexaCell customer portal...
            </div>
          ) : customer ? (
            <>
              {nav === 'overview' && (
                <div className="space-y-6">
                  <div className="vl-surface rounded-2xl p-6 sm:p-7 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                        Subscriber Account · <span className="font-mono">{customer.external_reference}</span>
                      </div>
                      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                        {customer.name.split(' (')[0]}
                      </h1>
                      <p className="text-sm text-zinc-500 vl-nums">
                        Line <strong className="font-medium text-zinc-800">{maskedPhone}</strong> · {currentPlan}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openSimReplacementForm}
                      className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                    >
                      Replace My SIM
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-sm">
                    <FieldCard label="Account Status" value="Active · In Good Standing" accent="emerald" />
                    <FieldCard label="SIM Status" value={simStatus} />
                    <FieldCard label="Registered Mobile" value={maskedPhone} />
                    <FieldCard label="Registered Device" value={registeredDevice} />
                    <FieldCard label="Current Plan" value={currentPlan} />
                    <FieldCard
                      label="Account Security"
                      value={customer.enrollment_status === 'enrolled' ? 'VoiceLock Protected' : 'Standard Verification'}
                    />
                  </div>

                  <div className="vl-surface rounded-2xl p-6 space-y-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Recent Account Activity
                    </h2>
                    <ul className="divide-y divide-zinc-100 text-sm">
                      {activityList.map((item, idx) => (
                        <li key={idx} className="py-3 flex justify-between gap-3 first:pt-1 last:pb-0">
                          <span className="text-zinc-700">{item.event}</span>
                          <span className="text-xs text-zinc-500 shrink-0 vl-nums">{item.date}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {nav === 'sim' && (
                <div className="space-y-6">
                  {flowStep === 'idle' && (
                    <div className="vl-surface rounded-2xl p-6 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h1 className="text-lg font-semibold text-zinc-950">My SIM &amp; Line Details</h1>
                          <p className="text-sm text-zinc-500">
                            Manage your active SIM card, eSIM profile, and device pairing.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={openSimReplacementForm}
                          className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                        >
                          Replace My SIM
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                        <FieldCard label="Registered Mobile Number" value={maskedPhone} />
                        <FieldCard label="SIM Type" value={simType} />
                        <FieldCard label="SIM Status" value={simStatus} accent="emerald" />
                        <FieldCard label="Last SIM Update" value={lastSimUpdate} />
                        <FieldCard label="Registered Device" value={registeredDevice} />
                        <FieldCard label="Current ICCID" value={`••••-${simIccid.slice(-4)}`} />
                      </div>
                    </div>
                  )}

                  {flowStep === 'request_form' && (
                    <div className="vl-surface rounded-2xl p-6 space-y-5">
                      <div>
                        <h1 className="text-lg font-semibold text-zinc-950">
                          {isAttackMode ? 'Attack Attempt Details — SIM Replacement' : 'Request SIM Replacement'}
                        </h1>
                        <p className="text-sm text-zinc-500 mt-1">
                          {isAttackMode
                            ? `Simulated attacker targeting ${customer.name} (${maskedPhone}).`
                            : 'Complete the details below. VoiceLock verifies identity before provisioning a replacement SIM.'}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="sim-reason" className="block text-xs font-medium text-zinc-700 mb-1.5">
                            Reason for Replacement
                          </label>
                          <select
                            id="sim-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900"
                          >
                            <option value="Lost SIM">Lost SIM</option>
                            <option value="Damaged SIM">Damaged SIM</option>
                            <option value="SIM not working">SIM not working</option>
                            <option value="Upgrade to another SIM type">Upgrade to another SIM type</option>
                          </select>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-zinc-700 mb-1.5">Request Reference</div>
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm font-mono text-zinc-800 vl-nums">
                            {requestId}
                          </div>
                        </div>
                      </div>

                      <label className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-sm text-zinc-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmedNumber}
                          onChange={(e) => setConfirmedNumber(e.target.checked)}
                          className="mt-1 rounded border-zinc-300 text-zinc-950"
                        />
                        <span>
                          I confirm this SIM replacement is for registered mobile number{' '}
                          <strong className="font-semibold text-zinc-950">{maskedPhone}</strong> ({customer.name}).
                        </span>
                      </label>

                      <div className="rounded-xl border border-zinc-200/80 bg-zinc-50 p-3.5 flex items-start gap-2.5 text-xs text-zinc-600">
                        <ShieldCheck className="h-4 w-4 text-zinc-700 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                          Your request stays pending until VoiceLock verifies your spoken challenge and issues a
                          single-use authorization token.
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFlowStep('idle')
                            if (isAttackMode) toggleAttackMode(false)
                          }}
                          className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!confirmedNumber}
                          onClick={() => setFlowStep('verifying')}
                          className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                        >
                          Continue to Security Verification
                        </button>
                      </div>
                    </div>
                  )}

                  {flowStep === 'verifying' && tenant && (
                    <div className="space-y-4">
                      {isAttackMode && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <div className="text-rose-700 font-medium">Target Account</div>
                            <div className="font-semibold text-rose-950 mt-0.5">{customer.name} ({maskedPhone})</div>
                          </div>
                          <div>
                            <div className="text-rose-700 font-medium">Attempted Operation</div>
                            <div className="font-semibold text-rose-950 mt-0.5">SIM Replacement ({requestId})</div>
                          </div>
                          <div>
                            <div className="text-rose-700 font-medium">Status</div>
                            <div className="font-semibold text-rose-950 mt-0.5">{lastDecisionOutcome ?? 'Awaiting Attacker Audio'}</div>
                          </div>
                        </div>
                      )}

                      <VoiceLockVerification
                        tenantId={tenant.id}
                        userId={customer.id}
                        action="sim_replacement"
                        actionLabel="SIM Replacement"
                        resourceReference={requestId}
                        maskedAccountDisplay={maskedPhone}
                        requireEidos={true}
                        attackSimulationMode={isAttackMode}
                        onVerified={handleVerified}
                        onContinueAction={(res) => void handleContinueSimReplacement(res)}
                        continuing={executingOp}
                        onCancel={() => setFlowStep('idle')}
                      />
                    </div>
                  )}

                  {flowStep === 'confirmed' && confirmedRecord && (
                    <div className="vl-surface rounded-2xl border-emerald-200 p-6 space-y-5">
                      <div className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h1 className="text-lg font-semibold text-zinc-950">
                            SIM Replacement Request Confirmed
                          </h1>
                          <p className="text-sm text-zinc-600 mt-0.5">
                            VoiceLock validated and consumed your single-use authorization token.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
                        <FieldCard label="Request ID" value={confirmedRecord.resource_reference} />
                        <FieldCard label="Masked Mobile" value={maskedPhone} />
                        <FieldCard label="Status" value="Provisioned &amp; Authorized" accent="emerald" />
                        <FieldCard label="Verification" value="VoiceLock Verified" accent="emerald" />
                      </div>

                      <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-4 text-xs text-zinc-600 space-y-1">
                        <div className="font-semibold text-zinc-950">Next Steps</div>
                        <p>
                          New eSIM activation QR is queued to your verified device, or visit any NexaCell location
                          with Request ID <code className="font-mono font-semibold text-zinc-900">{confirmedRecord.resource_reference}</code>.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={() => setFlowStep('idle')}
                          className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-medium text-white hover:bg-zinc-800"
                        >
                          Return to My SIM
                        </button>
                        <Link
                          to={`/security/decisions/${confirmedRecord.session_id}`}
                          className="rounded-full border border-zinc-200 bg-white px-5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                        >
                          Inspect in Security Dashboard
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {nav === 'security' && (
                <div className="vl-surface rounded-2xl p-6 space-y-4">
                  <h1 className="text-lg font-semibold text-zinc-950">Account Security Settings</h1>
                  <p className="text-sm text-zinc-600">
                    High-risk operations—including SIM replacement and number transfer—are protected by VoiceLock.
                  </p>
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-950">Voice Verification Profile</div>
                      <div className="text-xs text-zinc-500">
                        Status: {customer.enrollment_status === 'enrolled' ? 'Active Voiceprint Enrolled' : 'Not Enrolled'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEnrollModalOpen(true)}
                      className="rounded-full bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
                    >
                      {customer.enrollment_status === 'enrolled' ? 'Update Voiceprint' : 'Enroll Voiceprint'}
                    </button>
                  </div>
                </div>
              )}

              {(nav === 'requests' || nav === 'activity') && (
                <div className="vl-surface rounded-2xl p-6 space-y-4">
                  <h1 className="text-lg font-semibold text-zinc-950">
                    {nav === 'requests' ? 'SIM & Service Requests' : 'Account Activity Log'}
                  </h1>
                  {executions.length === 0 ? (
                    <p className="text-sm text-zinc-500 py-4">
                      No authorized SIM replacement requests completed yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-100">
                      {executions.map((ex) => (
                        <li key={ex.id} className="py-3.5 text-sm space-y-1 first:pt-1 last:pb-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-zinc-950">{ex.resource_reference}</span>
                            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                              {ex.execution_status}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-600">{ex.summary}</p>
                          <div className="text-[11px] text-zinc-400 vl-nums">
                            {new Date(ex.created_at).toLocaleString()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          ) : null}
        </main>
      </div>

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
          industry="telecom"
          onRegistered={(user) => {
            setSelectedUserId(user.id)
            setFlowStep('idle')
            void loadPortal(true)
          }}
          onClose={() => setRegisterModalOpen(false)}
        />
      )}
    </div>
  )
}

function FieldCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'emerald'
}) {
  return (
    <div className="vl-surface rounded-2xl p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-sm font-semibold mt-1.5 vl-nums ${accent === 'emerald' ? 'text-emerald-700' : 'text-zinc-950'}`}>
        {value}
      </div>
    </div>
  )
}
