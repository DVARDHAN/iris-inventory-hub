import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { PageHead, Modal, Field } from '../components/ui'

type Setting = { key: string; value: number; label: string }
type User = { email: string; full_name: string | null; role: string; created_at: string }

export default function Settings() {
  const { canWrite, isAdmin, email, toast } = useApp()
  const [settings, setSettings] = useState<Setting[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [adding, setAdding] = useState<Partial<User> & { password?: string } | null>(null)
  const [pw, setPw] = useState('')

  const load = async () => {
    const [s, u] = await Promise.all([
      supabase.from('app_settings').select('*').order('key'),
      supabase.from('app_users').select('*').order('created_at'),
    ])
    setSettings((s.data as Setting[]) ?? []); setUsers((u.data as User[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const saveSetting = async (k: string, v: string) => {
    const n = Number(v); if (!n || n <= 0) return toast('Enter a positive number', 'err')
    const { error } = await supabase.from('app_settings').update({ value: n }).eq('key', k)
    if (error) return toast(error.message, 'err')
    toast('Setting saved — health and suggestions now use it'); load()
  }
  const setRole = async (u: User, role: string) => {
    const { error } = await supabase.from('app_users').update({ role }).eq('email', u.email)
    if (error) return toast(error.message, 'err')
    toast('Role updated'); load()
  }
  const remove = async (u: User) => {
    if (!confirm(`Remove access for ${u.email}?`)) return
    const { error } = await supabase.from('app_users').delete().eq('email', u.email)
    if (error) return toast(error.message, 'err')
    toast('Access removed'); load()
  }
  const changePw = async () => {
    if (pw.length < 8) return toast('Use at least 8 characters', 'err')
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return toast(error.message, 'err')
    setPw(''); toast('Password changed')
  }
  const addUser = async () => {
    if (!adding?.email) return
    const { error } = await supabase.rpc('admin_upsert_user', { p_email: adding.email, p_password: adding.password ?? '', p_role: adding.role ?? 'member', p_name: adding.full_name ?? null })
    if (error) return toast(error.message, 'err')
    toast(`${adding.email} can now sign in`); setAdding(null); load()
  }

  return (
    <>
      <PageHead title="Settings & users" />
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Replenishment rules</h2></div>
          <div className="settings-list">
            {settings.map(s => (
              <form key={s.key} className="setting-row" onSubmit={e => { e.preventDefault(); saveSetting(s.key, (e.currentTarget.elements.namedItem('v') as HTMLInputElement).value) }}>
                <label htmlFor={s.key}>{s.label}</label>
                <div className="row gap-s">
                  <input id={s.key} name="v" type="number" step="any" defaultValue={s.value} disabled={!canWrite} />
                  {canWrite && <button className="btn sm">Save</button>}
                </div>
              </form>
            ))}
          </div>
          <p className="small muted">Per-SKU target cover and lead time (under SKUs & masters) override these defaults. Requests are auto-raised daily at 8:00 AM IST.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Your password</h2></div>
          <p className="small muted">Signed in as {email}</p>
          <div className="row gap-s">
            <input type="password" placeholder="New password (8+ characters)" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
            <button className="btn primary" onClick={changePw}>Change</button>
          </div>
        </section>

        <section className="card span-2">
          <div className="card-head"><h2>Team access</h2>{isAdmin && <button className="btn primary sm" onClick={() => setAdding({ role: 'member' })}>Add user</button>}</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Email</th><th>Name</th><th>Role</th>{isAdmin && <th />}</tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.email}><td>{u.email}</td><td>{u.full_name}</td>
                <td>{isAdmin && u.email !== email.toLowerCase()
                  ? <select className="sm" value={u.role} onChange={e => setRole(u, e.target.value)}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select>
                  : <span className="role-chip">{u.role}</span>}</td>
                {isAdmin && <td className="nowrap">
                  <button className="btn ghost sm" onClick={() => setAdding({ ...u, password: '' })}>Reset password</button>
                  {u.email !== email.toLowerCase() && <button className="btn ghost sm" onClick={() => remove(u)}>Remove</button>}
                </td>}
              </tr>))}</tbody>
          </table></div>
          <p className="small muted">Admin: everything incl. users · Member: add/edit data · Viewer: read-only.</p>
        </section>
      </div>

      {adding && (
        <Modal title={adding.created_at ? `Reset password · ${adding.email}` : 'Add user'} onClose={() => setAdding(null)}>
          <div className="form-grid">
            <Field label="Email"><input type="email" value={adding.email ?? ''} disabled={!!adding.created_at} onChange={e => setAdding({ ...adding, email: e.target.value })} /></Field>
            <Field label="Name"><input value={adding.full_name ?? ''} onChange={e => setAdding({ ...adding, full_name: e.target.value })} /></Field>
            <Field label="Role"><select value={adding.role} onChange={e => setAdding({ ...adding, role: e.target.value })}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select></Field>
            <Field label={adding.created_at ? 'New password' : 'Temporary password'} hint="8+ characters — share it with them privately; they can change it in Settings">
              <input type="text" value={adding.password ?? ''} onChange={e => setAdding({ ...adding, password: e.target.value })} /></Field>
          </div>
          <div className="modal-foot"><button className="btn ghost" onClick={() => setAdding(null)}>Cancel</button><button className="btn primary" onClick={addUser}>Save</button></div>
        </Modal>
      )}
    </>
  )
}
