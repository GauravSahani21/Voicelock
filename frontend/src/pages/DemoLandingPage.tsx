import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck,
  Smartphone,
  Headphones,
  Landmark,
  GraduationCap,
  Swords,
  LayoutDashboard,
  RotateCcw,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLivePolling } from '../hooks/useLivePolling'
import { api } from '../services/api'
import type { DemoOverviewState } from '../types'

export function DemoLandingPage() {
  const { ensureDemoSession } = useAuth()
  const navigate = useNavigate()
  const [demoState, setDemoState] = useState<DemoOverviewState | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const [navBusy, setNavBusy] = useState<string | null>(null)

  const loadState = useCallback(() => {
    api
      .demoOverviewState()
      .then(setDemoState)
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadState()
  }, [loadState])

  useLivePolling(loadState, { intervalMs: 5000, enabled: true })

  const openPortal = async (
    path: string,
    roleMode: 'admin' | 'telecom' | 'helpdesk' | 'banking' | 'education' = 'admin',
  ) => {
    setNavBusy(path)
    try {
      await ensureDemoSession(roleMode)
      navigate(path)
    } finally {
      setNavBusy(null)
    }
  }

  const handleResetDemo = async () => {
    setResetBusy(true)
    setResetNotice(null)
    try {
      await ensureDemoSession('admin')
      const res = await api.demoReset(false)
      setResetNotice(
        `Demo reset complete (${res.sessions_cleared} sessions cleared; voice enrollments preserved).`,
      )
      loadState()
    } catch (err: unknown) {
      setResetNotice(err instanceof Error ? err.message : 'Unable to reset demo state')
    } finally {
      setResetBusy(false)
    }
  }

  const portalCount = (industry: string) =>
    demoState?.portals.find((p) => p.industry === industry)

  const isMock = demoState?.provider_mode === 'mock'

  return (
    <div className="min-h-screen vl-hero-wash text-zinc-950 flex flex-col">
      {/* Minimal Frosted Top Navigation */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-zinc-200/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-15 py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-zinc-950 text-white flex items-center justify-center">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold tracking-tight text-zinc-950">VoiceLock</span>
              <span className="text-xs text-zinc-500 hidden sm:inline">Secure Access</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {demoState && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${isMock ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  aria-hidden="true"
                />
                <span>{isMock ? 'Mock Adapter' : 'Detectif Live'}</span>
              </span>
            )}

            <button
              type="button"
              disabled={Boolean(navBusy)}
              onClick={() => void openPortal('/security', 'admin')}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 transition-colors"
            >
              <LayoutDashboard className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
              <span>Security Dashboard</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-12">
        {/* Minimal Editorial Hero */}
        <section className="max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200/90 bg-white px-3 py-1 text-xs font-medium text-zinc-600 shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden="true" />
            <span>One gateway · Multiple industries · Action-bound authorization</span>
          </div>

          <h1 className="vl-display-title font-semibold text-zinc-950">
            VoiceLock — Secure Access Demo
          </h1>

          <p className="vl-prose text-base sm:text-lg text-zinc-600 leading-relaxed">
            Your voice is another layer of security. VoiceLock protects sensitive actions against
            impersonation and unauthorized access.
          </p>

          <div className="pt-1 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={Boolean(navBusy)}
              onClick={() => void openPortal('/portals/telecom', 'admin')}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <span>Open Telecom Customer Portal</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              disabled={Boolean(navBusy)}
              onClick={() => void openPortal('/portals/telecom?mode=attack', 'admin')}
              className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2.5 text-sm font-medium text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
            >
              <Swords className="h-4 w-4" aria-hidden="true" />
              <span>Launch Impersonation Attempt</span>
            </button>

            <button
              type="button"
              disabled={resetBusy}
              onClick={() => void handleResetDemo()}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${resetBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Reset Demo Sessions</span>
            </button>
          </div>

          {resetNotice && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2 text-xs font-medium text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{resetNotice}</span>
            </div>
          )}
        </section>

        {isMock && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs sm:text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
              <span>
                <strong>Mock Mode Active:</strong> <code>DETECTIF_API_KEY</code> is unset; Aletheia and Eidos
                use the labelled development adapter while challenges, STT, policies, and tokens run live.
              </span>
            </div>
            <Link to="/security/settings" className="text-xs font-semibold underline text-amber-950">
              Provider Status
            </Link>
          </div>
        )}

        {/* Industry Portals Bento */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Protected Applications
            </h2>
            <span className="text-xs text-zinc-500">
              Embedded VoiceLock verification · Unified policy &amp; token gateway
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Primary Emphasized Portal: Telecom */}
            <div className="lg:col-span-12 vl-surface-interactive rounded-2xl p-6 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-3.5 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200/80 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">
                    Primary Demonstration
                  </span>
                  <span className="text-xs text-zinc-500 vl-nums">
                    NexaCell Wireless · {portalCount('telecom')?.enrolled_users ?? 0}/
                    {portalCount('telecom')?.total_users ?? 2} enrolled
                  </span>
                </div>

                <div className="flex items-start gap-3.5">
                  <div className="h-11 w-11 rounded-xl bg-sky-50 border border-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                    <Smartphone className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-zinc-950">Telecom Portal</h3>
                    <p className="text-sm text-zinc-600 leading-relaxed">
                      Protect customer accounts against fraudulent SIM replacement and number takeover.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {['SIM Card Replacement', 'Number Port-Out PIN', 'Billing Inquiry'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={Boolean(navBusy)}
                  onClick={() => void openPortal('/portals/telecom', 'admin')}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                >
                  <span>Open Telecom Customer Portal</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={Boolean(navBusy)}
                  onClick={() => void openPortal('/portals/telecom?mode=attack', 'admin')}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 hover:border-rose-200 transition-colors"
                >
                  <Swords className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Test Attacker Impersonation</span>
                </button>
              </div>
            </div>

            {/* Companion Industry Portals */}
            <PortalCard
              title="IT Helpdesk Portal"
              brand="AcmeCorp Service Desk"
              description="Prevent attackers from impersonating employees to reset passwords, MFA or account credentials."
              icon={<Headphones className="h-5 w-5 text-indigo-600" aria-hidden="true" />}
              iconBg="bg-indigo-50 border border-indigo-100"
              protectedActions={['Reset MFA', 'Reset Password', 'Phone Change', 'Privileged Access']}
              enrolledSummary={`${portalCount('helpdesk')?.enrolled_users ?? 0}/${portalCount('helpdesk')?.total_users ?? 2} enrolled`}
              buttonLabel="Open Employee Helpdesk Portal"
              busy={navBusy === '/portals/helpdesk'}
              onOpen={() => void openPortal('/portals/helpdesk', 'admin')}
            />

            <PortalCard
              title="Banking Portal"
              brand="Crestline Digital Bank"
              description="Protect sensitive banking operations such as account recovery and registered mobile number changes."
              icon={<Landmark className="h-5 w-5 text-emerald-700" aria-hidden="true" />}
              iconBg="bg-emerald-50 border border-emerald-100"
              protectedActions={['Change Phone', 'Add Beneficiary', 'Account Recovery', 'Account Details']}
              enrolledSummary={`${portalCount('banking')?.enrolled_users ?? 0}/${portalCount('banking')?.total_users ?? 1} enrolled`}
              buttonLabel="Open Banking Portal"
              busy={navBusy === '/portals/banking'}
              onOpen={() => void openPortal('/portals/banking', 'admin')}
            />

            <PortalCard
              title="College Portal"
              brand="Summit University"
              description="Protect student and faculty information, account recovery and sensitive academic records."
              icon={<GraduationCap className="h-5 w-5 text-amber-700" aria-hidden="true" />}
              iconBg="bg-amber-50 border border-amber-100"
              protectedActions={['Academic Records', 'Change Phone', 'Password Reset', 'Faculty Records']}
              enrolledSummary={`${portalCount('education')?.enrolled_users ?? 0}/${portalCount('education')?.total_users ?? 3} enrolled`}
              buttonLabel="Open College Portal"
              busy={navBusy === '/portals/college'}
              onOpen={() => void openPortal('/portals/college', 'admin')}
            />
          </div>
        </section>

        {/* Minimal Sequence Strip */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Guided Demo Flow
            </h2>
            <Link to="/login" className="text-xs font-medium text-zinc-600 hover:text-zinc-950 transition-colors">
              Operator Sign In (Role-Scoped) &rarr;
            </Link>
          </div>
          <ol className="vl-surface rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200/70 overflow-hidden">
            {[
              { num: '01', title: 'Telecom Portal', desc: 'Inspect NexaCell customer & active SIM.', path: '/portals/telecom' },
              { num: '02', title: 'Legitimate SIM Swap', desc: 'Verify enrolled voice & issue token.', path: '/portals/telecom' },
              { num: '03', title: 'Attack Simulation', desc: 'Submit attacker audio & observe block.', path: '/portals/telecom?mode=attack' },
              { num: '04', title: 'Helpdesk MFA Reset', desc: 'Same gateway, stricter IT policy.', path: '/portals/helpdesk' },
              { num: '05', title: 'Operator Console', desc: 'Inspect Aletheia, Eidos & audit log.', path: '/security' },
            ].map((item) => (
              <li key={item.num}>
                <button
                  type="button"
                  onClick={() => void openPortal(item.path, 'admin')}
                  className="w-full h-full text-left p-4 hover:bg-zinc-50 transition-colors flex flex-col justify-between gap-2"
                >
                  <div>
                    <span className="text-[11px] font-mono text-zinc-400">{item.num}</span>
                    <div className="text-xs font-semibold text-zinc-950 mt-0.5">{item.title}</div>
                    <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{item.desc}</div>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  )
}

function PortalCard({
  title,
  brand,
  description,
  icon,
  iconBg,
  protectedActions,
  enrolledSummary,
  buttonLabel,
  busy,
  onOpen,
}: {
  title: string
  brand: string
  description: string
  icon: React.ReactNode
  iconBg: string
  protectedActions: string[]
  enrolledSummary: string
  buttonLabel: string
  busy: boolean
  onOpen: () => void
}) {
  return (
    <div className="lg:col-span-4 vl-surface-interactive rounded-2xl p-6 flex flex-col justify-between gap-5">
      <div className="space-y-3.5">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-950">{title}</h3>
            <div className="text-xs text-zinc-500 truncate vl-nums">
              {brand} · {enrolledSummary}
            </div>
          </div>
        </div>

        <p className="text-sm text-zinc-600 leading-relaxed">{description}</p>

        <div className="flex flex-wrap gap-1.5">
          {protectedActions.map((act) => (
            <span key={act} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
              {act}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        className="w-full inline-flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-2.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-colors disabled:opacity-50"
      >
        <span>{busy ? 'Opening...' : buttonLabel}</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
