import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FileSearch,
  Mic,
  ShieldCheck,
  Sliders,
  ScrollText,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  ArrowLeft,
  FlaskConical,
  Workflow,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLivePolling } from '../../hooks/useLivePolling'
import { api } from '../../services/api'
import type { SessionDetail } from '../../types'

const NAV_GROUPS = [
  {
    heading: 'Live Monitoring',
    items: [
      { to: '/security', label: 'Overview', icon: LayoutDashboard },
      { to: '/security/requests', label: 'Verification Requests', icon: FileSearch },
      { to: '/security/audit', label: 'Audit Logs', icon: ScrollText },
    ],
  },
  {
    heading: 'Testing & Automation',
    items: [
      { to: '/security/sandbox', label: 'Security Sandbox', icon: FlaskConical },
      { to: '/security/automation', label: 'Automation Center', icon: Workflow },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      { to: '/security/enrollment', label: 'Voice Enrollment', icon: Mic },
      { to: '/security/policies', label: 'Security Policies', icon: Sliders },
      { to: '/security/settings', label: 'Settings', icon: Settings },
    ],
  },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { operator, tenants, selectedTenantId, setSelectedTenantId, providerStatus, refreshProviderStatus, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [alerts, setAlerts] = useState<SessionDetail[]>([])
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setMobileOpen(false)
    setAlertsOpen(false)
  }, [location.pathname])

  const loadAlerts = useCallback(() => {
    if (!operator) return
    api
      .dashboardOverview(selectedTenantId || undefined)
      .then((res) => setAlerts(res.recent_suspicious_requests))
      .catch(() => {})
  }, [operator, selectedTenantId])

  useEffect(() => {
    loadAlerts()
  }, [loadAlerts, location.pathname])

  useLivePolling(
    () => {
      loadAlerts()
      void refreshProviderStatus().catch(() => {})
    },
    { intervalMs: 6000, enabled: Boolean(operator) },
  )

  const isMock = providerStatus?.provider_mode === 'mock'

  return (
    <div className="min-h-screen flex bg-[#fafafa] text-zinc-950 overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-zinc-950 text-zinc-100 border-r border-zinc-800/80">
        <div className="h-15 flex items-center gap-2.5 px-5 border-b border-zinc-800/80">
          <div className="h-8 w-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center">
            <ShieldCheck className="h-4 w-4 text-white" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-white">VoiceLock</div>
            <div className="text-[11px] text-zinc-400">Security Console</div>
          </div>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          <Link
            to="/"
            className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>User Demo Portals</span>
            </span>
            <span className="text-[10px] text-zinc-500">Switch</span>
          </Link>
          <div className="space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.heading} className="space-y-0.5">
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group.heading}
                </div>
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/security'}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                        isActive
                          ? 'bg-white/12 text-white'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        </nav>

        <div className="p-4 border-t border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
          <div className="flex items-center justify-between text-zinc-300">
            <span className="font-medium">Gateway Prototype</span>
            <span className="font-mono text-[10px] text-zinc-500">v0.1</span>
          </div>
          <p className="leading-relaxed text-zinc-500">
            Voice signals assist policy decisions; not proof of legal identity.
          </p>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-zinc-950 text-zinc-100 flex flex-col h-full">
            <div className="h-15 flex items-center justify-between px-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-white" aria-hidden="true" />
                <span className="text-sm font-semibold text-white">VoiceLock Console</span>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
              <Link
                to="/"
                className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>User Demo Portals</span>
              </Link>
              <div className="space-y-4">
                {NAV_GROUPS.map((group) => (
                  <div key={group.heading} className="space-y-0.5">
                    <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {group.heading}
                    </div>
                    {group.items.map(({ to, label, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={to === '/security'}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                            isActive ? 'bg-white/12 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'
                          }`
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{label}</span>
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
            </nav>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0 w-full">
        <header className="sticky top-0 z-30 h-15 bg-white/85 backdrop-blur-md border-b border-zinc-200/80 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <label htmlFor="tenant-selector" className="text-xs font-medium text-zinc-500 hidden sm:inline">
                Tenant
              </label>
              <select
                id="tenant-selector"
                value={selectedTenantId}
                disabled={Boolean(operator?.tenant_id)}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 min-w-0 max-w-[155px] sm:max-w-xs disabled:bg-zinc-100 disabled:text-zinc-500"
              >
                {operator?.role === 'platform_admin' && <option value="">All Tenants</option>}
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.industry})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/security/settings')}
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              title="Click to inspect Detectif.ai provider status"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isMock ? 'bg-amber-500' : 'bg-emerald-500'}`}
                aria-hidden="true"
              />
              <span>{isMock ? 'Mock Adapter' : 'Detectif Live'}</span>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                aria-label="Recent security alerts"
                aria-expanded={alertsOpen}
                onClick={() => setAlertsOpen((v) => !v)}
                className="relative p-2 rounded-full border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-colors"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {alerts.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white flex items-center justify-center vl-nums">
                    {alerts.length}
                  </span>
                )}
              </button>

              {alertsOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-zinc-200 bg-white shadow-lg p-3 z-40">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-100">
                    <span className="text-xs font-semibold text-zinc-950">Suspicious / Held Requests</span>
                    <span className="text-[11px] text-zinc-500 vl-nums">{alerts.length} recent</span>
                  </div>
                  {alerts.length === 0 ? (
                    <p className="text-xs text-zinc-500 py-3 text-center">No recent security alerts.</p>
                  ) : (
                    <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                      {alerts.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setAlertsOpen(false)
                              navigate(`/security/decisions/${s.id}`)
                            }}
                            className="w-full text-left rounded-xl p-2 hover:bg-zinc-50 transition-colors"
                          >
                            <div className="flex items-center justify-between text-xs font-medium text-zinc-900">
                              <span>{s.requested_action}</span>
                              <span className="text-rose-600 font-semibold">{s.decision?.outcome ?? s.status}</span>
                            </div>
                            <div className="text-[11px] text-zinc-500 mt-0.5">
                              {s.user_name} · {s.tenant_name}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Operator Profile + Sign Out */}
            <div className="flex items-center gap-2 pl-2 border-l border-zinc-200">
              <div className="hidden sm:block text-right">
                <div className="text-xs font-medium text-zinc-950 leading-tight">
                  {operator?.full_name}
                </div>
                <div className="text-[11px] text-zinc-500">{operator?.role}</div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden md:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 w-full p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">{children}</main>
      </div>
    </div>
  )
}
