import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, Eye, EyeOff, AlertCircle, Lock, ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ApiClientError } from '../services/api'

const DEMO_ACCOUNTS = [
  {
    label: 'Platform Security Admin',
    email: 'admin@voicelock.demo',
    password: 'DemoAdmin!2026',
    scope: 'All 4 Tenants · Full Governance',
  },
  {
    label: 'Telecom Fraud Operator',
    email: 'telecom.ops@voicelock.demo',
    password: 'DemoTelecom!2026',
    scope: 'Demo Telecom only',
  },
  {
    label: 'Helpdesk Security Operator',
    email: 'helpdesk.ops@voicelock.demo',
    password: 'DemoHelpdesk!2026',
    scope: 'Demo Enterprise only',
  },
  {
    label: 'Bank Fraud Specialist',
    email: 'bank.ops@voicelock.demo',
    password: 'DemoBank!2026',
    scope: 'Demo Bank only',
  },
  {
    label: 'University Registrar Ops',
    email: 'registrar.ops@voicelock.demo',
    password: 'DemoUni!2026',
    scope: 'Demo University only',
  },
]

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailTouched, setEmailTouched] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email.trim(), password)
      navigate('/security')
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        setError(err.message)
      } else {
        setError('Unable to sign in. Verify backend availability and credentials.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen vl-hero-wash flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Sign-in Card */}
        <div className="lg:col-span-7 vl-surface rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-7">
              <div className="h-10 w-10 rounded-xl bg-zinc-950 text-white flex items-center justify-center">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-zinc-950">VoiceLock Gateway</h1>
                <p className="text-xs text-zinc-500">
                  Security Operations &amp; Action Authorization Console
                </p>
              </div>
            </div>

            <h2 className="text-base font-semibold text-zinc-950 mb-1">Operator Sign In</h2>
            <p className="text-sm text-zinc-500 mb-6">
              Authenticate to manage enrollments, inspect verification decisions, and enforce policies.
            </p>

            {error && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="field">
                <label htmlFor="email" className="block text-xs font-medium text-zinc-700 mb-1">
                  Operator Email
                </label>
                <span id="email-hint" className="block text-xs text-zinc-500 mb-1.5">
                  Example: admin@voicelock.demo
                </span>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  spellCheck={false}
                  autoComplete="username"
                  enterKeyHint="next"
                  aria-describedby="email-hint"
                  aria-invalid={emailTouched && !email.includes('@') ? 'true' : 'false'}
                  value={email}
                  onBlur={() => setEmailTouched(true)}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
                  placeholder="operator@voicelock.demo"
                />
                <div className="field-error-msg">Enter a valid operator email address.</div>
              </div>

              <div className="field">
                <label htmlFor="current-password" className="block text-xs font-medium text-zinc-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="current-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={4}
                    autoComplete="current-password"
                    enterKeyHint="done"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 pr-11 text-sm text-zinc-950 focus:border-zinc-950 focus:outline-none"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 hover:text-zinc-900"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <div className="field-error-msg">Password is required (minimum 4 characters).</div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                <span>{submitting ? 'Signing In...' : 'Sign In'}</span>
              </button>
            </form>
          </div>

          <p className="mt-6 pt-4 border-t border-zinc-100 text-xs text-zinc-500 flex items-center justify-between gap-2 flex-wrap">
            <span>Voice signals assist security policies; not proof of legal identity.</span>
            <Link to="/" className="inline-flex items-center gap-1 font-medium text-zinc-900 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Demo Portals Hub
            </Link>
          </p>
        </div>

        {/* Right: Demo Credentials Panel */}
        <div className="lg:col-span-5 vl-surface rounded-2xl p-6 flex flex-col justify-between bg-white/80">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Fictional Demo Tenants &amp; RBAC
            </div>
            <h2 className="text-base font-semibold text-zinc-950 mb-1">Demo Operator Accounts</h2>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
              Click any role below to fill credentials and test strict tenant isolation or cross-industry admin access.
            </p>

            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  onClick={() => {
                    setEmail(acct.email)
                    setPassword(acct.password)
                    setError(null)
                  }}
                  className="w-full text-left rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 hover:border-zinc-400 hover:bg-white transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-950">{acct.label}</span>
                    <span className="text-[11px] font-medium text-zinc-600">Fill &rarr;</span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-600 mt-1">{acct.email}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{acct.scope}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-zinc-100 text-[11px] text-zinc-500">
            Single-tenant operators cannot query or inspect sessions belonging to another tenant.
          </div>
        </div>
      </div>
    </div>
  )
}
