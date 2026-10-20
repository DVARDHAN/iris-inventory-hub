import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtNum, fmtNum1, fmtDate, fmtINR, downloadCSV } from '../lib/format'
import { Badge, PageHead, Empty, Modal, Field } from '../components/ui'

type Req = {
  id: string; request_no: number; sku_id: string; warehouse_id: string | null
  suggested_qty: number; requested_qty: number; received_qty: number
  priority: string; status: string; source: string
  on_hand_at_request: number | null; ads_at_request: number | null; cover_at_request: number | null
  expected_date: string | null; notes: string | null; created_at: string; updated_at: string
}
const TABS = ['active', 'open', 'approved', 'ordered', 'received', 'cancelled', 'all'] as const
const NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: 'approved', label: 'Approve' }, { to: 'cancelled', label: 'Cancel' }],
  approved: [{ to: 'ordered', label: 'Mark ordered' }, { to: 'cancelled', label: 'Cancel' }],
  ordered: [{ to: 'received', label: 'Receive' }, { to: 'cancelled', label: 'Cancel' }],
  received: [], cancelled: [{ to: 'open', label: 'Reopen' }],
}

export default function Replenishment() {
  const { skus, warehouses, canWrite, toast } = useApp()
  const [rows, setRows] = useState<Req[]>([])
  const [tab, setTab] = useState<(typeof TABS)[number]>('active')
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Req | null>(null)
  const [receive, setReceive] = useState<Req | null>(null)
  const skuMap = useMemo(() => new Map(skus.map(s => [s.id, s])), [skus])
  const whMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const load = async () => {
    const { data, error } = await supabase.from('replenishment_requests').select('*').order('created_at', { ascending: false }).limit(1000)
    if (error) toast(error.message, 'err')
    setRows((data as Req[]) ?? []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const view = rows.filter(r => tab === 'all' ? true : tab === 'active' ? ['open', 'approved', 'ordered'].includes(r.status) : r.status === tab)
  const prioRank: Record<string, number> = { urgent: 0, high: 1, normal: 2 }
  view.sort((a, b) => (prioRank[a.priority] - prioRank[b.priority]) || b.created_at.localeCompare(a.created_at))
  const count = (t: string) => rows.filter(r => t === 'all' ? true : t === 'active' ? ['open', 'approved', 'ordered'].includes(r.status) : r.status === t).length
  const totalValue = view.reduce((a, r) => a + Number(r.requested_qty) * Number(skuMap.get(r.sku_id)?.unit_cost ?? 0), 0)

  const runAuto = async () => {
    const { data, error } = await supabase.rpc('raise_replenishment_requests', { p_source: 'manual' })
    if (error) return toast(error.message, 'err')
    toast(data ? `${data} new request${data === 1 ? '' : 's'} raised` : 'No new requests needed')
    load()
  }
  const setStatus = async (r: Req, to: string) => {
    if (to === 'received') return setReceive(r)
    const { error } = await supabase.from('replenishment_requests').update({ status: to }).eq('id', r.id)
    if (error) return toast(error.message, 'err')
    toast(`REQ-${r.request_no} → ${to}`); load()
  }

  return (
    <>
      <PageHead title="Replenishment" desc="Requests are raised automatically every day at 8:00 AM IST for SKUs below their 90-day cover target, or on demand. Receiving a request adds the stock to its warehouse.">
        <button className="btn ghost" onClick={() => downloadCSV('replenishment-requests.csv', view.map(r => {
          const s = skuMap.get(r.sku_id)
          return { request: 'REQ-' + r.request_no, sku_code: s?.sku_code, sku_name: s?.name, deliver_to: r.warehouse_id ? whMap.get(r.warehouse_id)?.name : '',
            requested_qty: r.requested_qty, suggested_qty: r.suggested_qty, received_qty: r.received_qty, unit_cost: s?.unit_cost,
            value_at_cost: Number(r.requested_qty) * Number(s?.unit_cost ?? 0), priority: r.priority, status: r.status,
            expected_date: r.expected_date, raised_on: r.created_at.slice(0, 10), notes: r.notes }
        }))}>Export CSV</button>
        {canWrite && <button className="btn primary" onClick={runAuto}>Check & raise now</button>}
      </PageHead>

      <div className="chips">
        {TABS.map(t => <button key={t} className={'chip' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)} <span>{count(t)}</span></button>)}
      </div>
      {view.length > 0 && <p className="small muted">{view.length} request{view.length === 1 ? '' : 's'} · {fmtINR(totalValue)} at cost</p>}

      <section className="card flush">
        {loading ? <div className="splash">Loading…</div> : view.length === 0 ? <Empty>No requests here.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Request</th><th>SKU</th><th>Deliver to</th><th className="r">Qty</th><th className="r">At request</th><th>Priority</th><th>Status</th><th>Expected</th>{canWrite && <th />}</tr></thead>
              <tbody>{view.map(r => {
                const s = skuMap.get(r.sku_id)
                return (
                  <tr key={r.id}>
                    <td><div className="mono">REQ-{r.request_no}</div><div className="small muted">{fmtDate(r.created_at.slice(0, 10))} · {r.source}</div></td>
                    <td><div className="mono">{s?.sku_code ?? '?'}</div><div className="small muted ellipsis" title={s?.name}>{s?.name}</div></td>
                    <td className="small">{r.warehouse_id ? whMap.get(r.warehouse_id)?.name : <span className="danger">Not set</span>}</td>
                    <td className="r"><strong>{fmtNum(r.requested_qty)}</strong>
                      {Number(r.suggested_qty) > 0 && Number(r.suggested_qty) !== Number(r.requested_qty) && <div className="small muted">sugg. {fmtNum(r.suggested_qty)}</div>}
                      {r.status === 'received' && <div className="small muted">rcvd {fmtNum(r.received_qty)}</div>}</td>
                    <td className="r small">{fmtNum(r.on_hand_at_request)} on hand<div className="muted">{fmtNum1(r.ads_at_request)}/day · {r.cover_at_request ?? '—'}d</div></td>
                    <td><Badge value={r.priority} /></td>
                    <td><Badge value={r.status} /></td>
                    <td className="small">{fmtDate(r.expected_date)}</td>
                    {canWrite && <td className="nowrap">
                      {NEXT[r.status].map(n => <button key={n.to} className={'btn sm ' + (n.to === 'cancelled' ? 'ghost' : '')} onClick={() => setStatus(r, n.to)}>{n.label}</button>)}
                      {r.status !== 'received' && <button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button>}
                    </td>}
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      {edit && <EditModal r={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load() }} />}
      {receive && <ReceiveModal r={receive} onClose={() => setReceive(null)} onDone={() => { setReceive(null); load() }} />}
    </>
  )
}

function EditModal({ r, onClose, onDone }: { r: Req; onClose: () => void; onDone: () => void }) {
  const { warehouses, toast } = useApp()
  const [f, setF] = useState({ requested_qty: String(r.requested_qty), warehouse_id: r.warehouse_id ?? '', priority: r.priority, expected_date: r.expected_date ?? '', notes: r.notes ?? '' })
  const save = async () => {
    const { error } = await supabase.from('replenishment_requests').update({
      requested_qty: Number(f.requested_qty), warehouse_id: f.warehouse_id || null, priority: f.priority,
      expected_date: f.expected_date || null, notes: f.notes || null }).eq('id', r.id)
    if (error) return toast(error.message, 'err')
    toast('Saved'); onDone()
  }
  return (
    <Modal title={`Edit REQ-${r.request_no}`} onClose={onClose}>
      <div className="form-grid">
        <Field label="Requested qty"><input type="number" value={f.requested_qty} onChange={e => setF({ ...f, requested_qty: e.target.value })} /></Field>
        <Field label="Deliver to"><select value={f.warehouse_id} onChange={e => setF({ ...f, warehouse_id: e.target.value })}>
          <option value="">— choose —</option>{warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Priority"><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option></select></Field>
        <Field label="Expected by"><input type="date" value={f.expected_date} onChange={e => setF({ ...f, expected_date: e.target.value })} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  )
}

function ReceiveModal({ r, onClose, onDone }: { r: Req; onClose: () => void; onDone: () => void }) {
  const { warehouses, toast } = useApp()
  const [qty, setQty] = useState(String(r.requested_qty))
  const [wh, setWh] = useState(r.warehouse_id ?? '')
  const save = async () => {
    if (!wh) return toast('Choose the receiving warehouse', 'err')
    const { error } = await supabase.from('replenishment_requests').update({ status: 'received', received_qty: Number(qty), warehouse_id: wh }).eq('id', r.id)
    if (error) return toast(error.message, 'err')
    toast(`Received ${qty} units — stock updated`); onDone()
  }
  return (
    <Modal title={`Receive REQ-${r.request_no}`} onClose={onClose}>
      <p className="muted small">The received quantity is added to the warehouse's stock as an inward entry.</p>
      <div className="form-grid">
        <Field label="Received qty"><input type="number" min={0} value={qty} onChange={e => setQty(e.target.value)} /></Field>
        <Field label="Into warehouse"><select value={wh} onChange={e => setWh(e.target.value)}>
          <option value="">— choose —</option>{warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Confirm receipt</button></div>
    </Modal>
  )
}
