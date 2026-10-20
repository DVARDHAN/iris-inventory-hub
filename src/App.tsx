import { useEffect, useState, FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { AppProvider, useApp } from './lib/store'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Sales from './pages/Sales'
import Returns from './pages/Returns'
import Health from './pages/Health'
import Replenishment from './pages/Replenishment'
import Masters from './pages/Masters'
import Settings from './pages/Settings'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="splash">Loading…</div>
  if (!session) return <Login />
  return (
    <AppProvider session={session}>
      <Shell />
    </AppProvider>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
    setBusy(false)
  }
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big"><Logo /> <span>IRIS Inventory Hub</span></div>
        <p className="muted">Stock, sell-out, returns and replenishment across every warehouse and marketplace.</p>
        <label className="field"><span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {err && <p className="danger">{err}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Access is by invitation. Ask your admin to add you.</p>
      </form>
    </div>
  )
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧' },
  { to: '/health', label: 'Inventory health', icon: '♥' },
  { to: '/replenishment', label: 'Replenishment', icon: '↻' },
  { to: '/inventory', label: 'Stock & warehouses', icon: '▦' },
  { to: '/sales', label: 'Sales', icon: '↗' },
  { to: '/returns', label: 'Returns', icon: '↙' },
  { to: '/masters', label: 'SKUs & masters', icon: '☰' },
  { to: '/settings', label: 'Settings & users', icon: '⚙' },
]

function Shell() {
  const { role, email } = useApp()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('theme') || 'auto' } catch { return 'auto' } })
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  if (role === undefined) return <div className="splash">Loading…</div>
  if (role === null) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand big"><Logo /> <span>IRIS Inventory Hub</span></div>
          <p>You're signed in as <strong>{email}</strong>, but this account hasn't been given access yet.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    )
  }

  return (
    <div className={'shell' + (open ? ' nav-open' : '')}>
      <aside className="sidebar">
        <div className="brand"><Logo /> <span>IRIS Inventory Hub</span></div>
        <nav>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who"><span className="small muted">{email}</span><span className="role-chip">{role}</span></div>
          <div className="row gap-s">
            <select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value)} className="sm">
              <option value="auto">Auto theme</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
            <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </aside>
      <div className="topbar">
        <button className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Menu">☰</button>
        <div className="brand"><Logo /> <span>IRIS Inventory Hub</span></div>
      </div>
      <div className="scrim" onClick={() => setOpen(false)} />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/health" element={<Health />} />
          <Route path="/replenishment" element={<Replenishment />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/masters" element={<Masters />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M8 11l8-4 8 4v10l-8 4-8-4z M8 11l8 4 8-4M16 15v10" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
