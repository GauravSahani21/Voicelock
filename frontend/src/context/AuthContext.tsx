import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getStoredToken, setStoredToken } from '../services/api'
import type { OperatorProfile, ProviderStatus, Tenant } from '../types'

interface AuthContextValue {
  operator: OperatorProfile | null
  tenants: Tenant[]
  selectedTenantId: string
  setSelectedTenantId: (id: string) => void
  selectedTenant: Tenant | null
  providerStatus: ProviderStatus | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  ensureDemoSession: (roleMode?: 'admin' | 'telecom' | 'helpdesk' | 'banking' | 'education') => Promise<Tenant[]>
  logout: () => Promise<void>
  refreshTenants: () => Promise<void>
  refreshProviderStatus: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<OperatorProfile | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string>('')
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const loadBootstrap = useCallback(async () => {
    const token = getStoredToken()
    if (!token) {
      setIsLoading(false)
      return
    }
    try {
      const [me, tenantList, prov] = await Promise.all([
        api.me(),
        api.listTenants(),
        api.providerStatus().catch(() => null),
      ])
      setOperator(me)
      setTenants(tenantList)
      setProviderStatus(prov)
      if (me.tenant_id) {
        setSelectedTenantId(me.tenant_id)
      }
    } catch {
      setStoredToken(null)
      setOperator(null)
      setTenants([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBootstrap()
  }, [loadBootstrap])

  const login = useCallback(async (email: string, password: string) => {
    const resp = await api.login(email, password)
    setStoredToken(resp.access_token)
    setOperator(resp.operator)
    const [tenantList, prov] = await Promise.all([
      api.listTenants(),
      api.providerStatus().catch(() => null),
    ])
    setTenants(tenantList)
    setProviderStatus(prov)
    if (resp.operator.tenant_id) {
      setSelectedTenantId(resp.operator.tenant_id)
    } else {
      setSelectedTenantId('')
    }
  }, [])

  const ensureDemoSession = useCallback(
    async (roleMode: 'admin' | 'telecom' | 'helpdesk' | 'banking' | 'education' = 'admin') => {
      if (operator && tenants.length > 0) {
        return tenants
      }
      const resp = await api.demoBootstrap(roleMode)
      setStoredToken(resp.access_token)
      setOperator(resp.operator)
      const [tenantList, prov] = await Promise.all([
        api.listTenants(),
        api.providerStatus().catch(() => null),
      ])
      setTenants(tenantList)
      setProviderStatus(prov)
      if (resp.operator.tenant_id) {
        setSelectedTenantId(resp.operator.tenant_id)
      } else {
        setSelectedTenantId('')
      }
      return tenantList
    },
    [operator, tenants],
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // Ignore logout network error when clearing client session
    } finally {
      setStoredToken(null)
      setOperator(null)
      setTenants([])
      setSelectedTenantId('')
      setProviderStatus(null)
    }
  }, [])

  const refreshTenants = useCallback(async () => {
    const list = await api.listTenants()
    setTenants(list)
  }, [])

  const refreshProviderStatus = useCallback(async () => {
    const prov = await api.providerStatus()
    setProviderStatus(prov)
  }, [])

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null

  return (
    <AuthContext.Provider
      value={{
        operator,
        tenants,
        selectedTenantId,
        setSelectedTenantId,
        selectedTenant,
        providerStatus,
        isLoading,
        login,
        ensureDemoSession,
        logout,
        refreshTenants,
        refreshProviderStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return ctx
}
