import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AppShell } from './components/layout/AppShell'
import { DemoLandingPage } from './pages/DemoLandingPage'
import { TelecomCustomerPortal } from './pages/telecom/TelecomCustomerPortal'
import { EmployeeHelpdeskPortal } from './pages/helpdesk/EmployeeHelpdeskPortal'
import { BankingPortal } from './pages/banking/BankingPortal'
import { CollegePortal } from './pages/education/CollegePortal'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { VerificationRequests } from './pages/VerificationRequests'
import { VerificationWorkbench } from './pages/VerificationWorkbench'
import { VoiceEnrollment } from './pages/VoiceEnrollment'
import { DecisionDetail } from './pages/DecisionDetail'
import { IndustryWorkflows } from './pages/IndustryWorkflows'
import { AttackSimulator } from './pages/AttackSimulator'
import { SecurityPolicies } from './pages/SecurityPolicies'
import { AuditLogs } from './pages/AuditLogs'
import { ApiIntegration } from './pages/ApiIntegration'
import { Settings } from './pages/Settings'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { operator, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading VoiceLock Gateway...
      </div>
    )
  }
  if (!operator) {
    return <Navigate to="/login" replace />
  }
  return <AppShell>{children}</AppShell>
}

function AppRoutes() {
  const { operator, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        Initializing security session...
      </div>
    )
  }

  return (
    <Routes>
      {/* Central Demo Entry Point & Customer-Facing Portals */}
      <Route path="/" element={<DemoLandingPage />} />
      <Route path="/portals/telecom" element={<TelecomCustomerPortal />} />
      <Route path="/portals/helpdesk" element={<EmployeeHelpdeskPortal />} />
      <Route path="/portals/banking" element={<BankingPortal />} />
      <Route path="/portals/college" element={<CollegePortal />} />

      {/* Operator Authentication */}
      <Route path="/login" element={operator ? <Navigate to="/security" replace /> : <Login />} />

      {/* Security Operator Console */}
      <Route path="/security" element={<ProtectedRoute><Overview /></ProtectedRoute>} />
      <Route path="/security/requests" element={<ProtectedRoute><VerificationRequests /></ProtectedRoute>} />
      <Route path="/security/verify" element={<ProtectedRoute><VerificationWorkbench /></ProtectedRoute>} />
      <Route path="/security/enrollment" element={<ProtectedRoute><VoiceEnrollment /></ProtectedRoute>} />
      <Route path="/security/decisions/:id" element={<ProtectedRoute><DecisionDetail /></ProtectedRoute>} />
      <Route path="/security/workflows" element={<ProtectedRoute><IndustryWorkflows /></ProtectedRoute>} />
      <Route path="/security/simulator" element={<ProtectedRoute><AttackSimulator /></ProtectedRoute>} />
      <Route path="/security/policies" element={<ProtectedRoute><SecurityPolicies /></ProtectedRoute>} />
      <Route path="/security/audit" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
      <Route path="/security/integration" element={<ProtectedRoute><ApiIntegration /></ProtectedRoute>} />
      <Route path="/security/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

      {/* Backward-compatible route redirects */}
      <Route path="/requests" element={<Navigate to="/security/requests" replace />} />
      <Route path="/verify" element={<Navigate to="/security/verify" replace />} />
      <Route path="/enrollment" element={<Navigate to="/security/enrollment" replace />} />
      <Route path="/workflows" element={<Navigate to="/security/workflows" replace />} />
      <Route path="/simulator" element={<Navigate to="/security/simulator" replace />} />
      <Route path="/policies" element={<Navigate to="/security/policies" replace />} />
      <Route path="/audit" element={<Navigate to="/security/audit" replace />} />
      <Route path="/integration" element={<Navigate to="/security/integration" replace />} />
      <Route path="/settings" element={<Navigate to="/security/settings" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
