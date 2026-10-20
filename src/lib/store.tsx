import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, fetchAll, Channel, Warehouse, Sku, Role } from './supabase'

type Masters = { channels: Channel[]; warehouses: Warehouse[]; skus: Sku[] }
type Ctx = Masters & {
  session: Session | null
  role: Role | null | undefined
  email: string
  canWrite: boolean
  isAdmin: boolean
  reloadMasters: () => Promise<void>
  toast: (msg: string, kind?: 'ok' | 'err') => void
}

const AppCtx = createContext<Ctx>(null as any)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [m, setM] = useState<Masters>({ channels: [], warehouses: [], skus: [] })
  const [role, setRole] = useState<Role | null | undefined>(undefined)
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([])
  const email = session.user.email ?? ''

  const reloadMasters = useCallback(async () => {
    const [c, w, s] = await Promise.all([
      supabase.from('channels').select('*').order('name'),
      supabase.from('warehouses').select('*').order('name'),
      fetchAll<Sku>((a, b) => supabase.from('skus').select('*').order('sku_code').range(a, b)).catch(() => [] as Sku[]),
    ])
    setM({ channels: c.data ?? [], warehouses: w.data ?? [], skus: s })
  }, [])

  useEffect(() => {
    reloadMasters()
    supabase.from('app_users').select('role').eq('email', email.toLowerCase()).maybeSingle()
      .then(({ data }) => setRole((data?.role as Role) ?? null))
  }, [email, reloadMasters])

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'err' ? 7000 : 3500)
  }, [])

  return (
    <AppCtx.Provider value={{
      ...m, session, role, email, reloadMasters, toast,
      canWrite: role === 'admin' || role === 'member', isAdmin: role === 'admin',
    }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
      </div>
    </AppCtx.Provider>
  )
}
