import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtNum, fmtINR, fmtDate, today, daysAgo, parseDate, downloadCSV } from '../lib/format'
import { PageHead, Empty, Modal, Field, Kpi, Badge } from '../components/ui'
import { CsvImport, lookup, toNum } from '../components/CsvImport'
import { SkuSelect } from './Inventory'

type Ret = { id: string; return_date: string; channel_id: string; sku_id: string; warehouse_id: string | null; qty: number; condition: string; reason: string | null; refund_value: number | null; order_ref: string | null }
const CONDITIONS = ['sellable', 'damaged', 'lost', 'in_transit']
const LIMIT = 1000

export default function Returns() {
  const { skus, channels, warehouses, canWrite, toast } = useApp()
  const [rows, setRows] = useState<Ret[]>([])
  const [total, setTotal] = useState(0)
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(today())
  const [ch, setCh] = useState('')
  const [cond, setCond] = useState('')
  const [modal, setModal] = useState<'add' | 'import' | null>(null)
  const [edit, setEdit] = useState<Ret | null>(null)
  const skuMap = useMemo(() => new Map(skus.map(s => [s.id, s])), [skus])
  const chMap = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels])
  const whMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const load = async () => {
    let qy = supabase.from('returns').select('*', { count: 'exact' }).gte('return_date', from).lte('return_date', to)
    if (ch) qy = qy.eq('channel_id', ch)
    if (cond) qy = qy.eq('condition', cond)
    const { data, count, error } = await qy.order('return_date', { ascending: false }).limit(LIMIT)
    if (error) toast(error.message, 'err')
    setRows((data as Ret[]) ?? []); setTotal(count ?? 0)
  }
  useEffect(() => { load() }, [from, to, ch, cond])

  const by = (c: string) => rows.filter(r => r.condition === c).reduce((a, r) => a + Number(r.qty), 0)
  const del = async (r: Ret) => {
    if (!confirm('Delete this return?')) return
    const { error } = await supabase.from('returns').delete().eq('id', r.id)
    if (error) return toast(error.message, 'err')
    toast('Deleted'); load()
  }

  return (
    <>
      <PageHead title="Returns" desc="Customer returns and RTOs by portal. Only returns marked sellable with a receiving warehouse go back into stock; mark in-transit returns sellable once they’ve been inspected.">
        <button className="btn ghost" onClick={() => downloadCSV('returns.csv', rows.map(r => ({ date: r.return_date, channel: chMap.get(r.channel_id)?.name, sku_code: skuMap.get(r.sku_id)?.sku_code, warehouse: r.warehouse_id ? whMap.get(r.warehouse_id)?.code : '', qty: r.qty, condition: r.condition, reason: r.reason, refund_value: r.refund_value, order_ref: r.order_ref })))}>Export CSV</button>
        {canWrite && <><button className="btn ghost" onClick={() => setModal('import')}>Import CSV</button><button className="btn primary" onClick={() => setModal('add')}>Add return</button></>}
      </PageHead>
      <div className="filters">
        <label className="inline">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <select value={ch} onChange={e => setCh(e.target.value)}><option value="">All channels</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={cond} onChange={e => setCond(e.target.value)}><option value="">All conditions</option>{CONDITIONS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select>
      </div>
      <div className="kpis">
        <Kpi label="Returned units" value={fmtNum(rows.reduce((a, r) => a + Number(r.qty), 0))} sub={total > LIMIT ? `Showing latest ${LIMIT}` : `${fmtNum(total)} lines`} />
        <Kpi label="Sellable (restocked)" value={fmtNum(by('sellable'))} />
        <Kpi label="Damaged" value={fmtNum(by('damaged'))} />
        <Kpi label="Lost" value={fmtNum(by('lost'))} />
        <Kpi label="Refund value" value={fmtINR(rows.reduce((a, r) => a + Number(r.refund_value ?? 0), 0))} />
      </div>
      <section className="card flush">
        {rows.length === 0 ? <Empty>No returns in this range.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Channel</th><th>SKU</th><th>Warehouse</th><th className="r">Qty</th><th>Condition</th><th>Reason</th><th className="r">Refund</th>{canWrite && <th />}</tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.return_date)}</td>
                  <td>{chMap.get(r.channel_id)?.name}</td>
                  <td className="mono">{skuMap.get(r.sku_id)?.sku_code}</td>
                  <td className="small">{r.warehouse_id ? whMap.get(r.warehouse_id)?.code : <span className="muted">—</span>}</td>
                  <td className="r">{fmtNum(r.qty)}</td>
                  <td><Badge value={r.condition} /></td>
                  <td className="small muted">{r.reason}</td>
                  <td className="r">{fmtINR(r.refund_value)}</td>
                  {canWrite && <td className="nowrap"><button className="btn ghost sm" onClick={() => setEdit(r)}>Edit</button><button className="icon-btn sm" aria-label="Delete" title="Delete" onClick={() => del(r)}>×</button></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {(modal === 'add' || edit) && <ReturnForm r={edit} onClose={() => { setModal(null); setEdit(null) }} onDone={() => { setModal(null); setEdit(null); toast('Return saved'); load() }} />}
      {modal === 'import' && (() => {
        const s = lookup(skus, 'sku_code'); const c = lookup(channels, 'code', 'name'); const w = lookup(warehouses, 'code', 'name')
        return <CsvImport title="Import returns"
          columns={['date', 'channel', 'sku_code', 'warehouse_code', 'qty', 'condition', 'reason', 'refund_value', 'order_ref']}
          sample={{ date: today(), channel: 'FLIPKART', sku_code: skus[0]?.sku_code ?? 'SKU-001', warehouse_code: warehouses[0]?.code ?? '', qty: 1, condition: 'sellable', reason: 'Customer changed mind', refund_value: 799, order_ref: '' }}
          notes={['condition: sellable, damaged, lost or in_transit (default sellable).', 'Sellable returns with a warehouse_code are added back to that warehouse’s stock.']}
          mapRow={r => {
            const date = parseDate(r.date ?? r.return_date); if (!date) return { error: `Bad date "${r.date ?? ''}"` }
            const channel_id = c(r.channel ?? r.channel_code ?? r.portal); if (!channel_id) return { error: `Unknown channel "${r.channel ?? r.portal ?? ''}"` }
            const sku_id = s(r.sku_code ?? r.sku); if (!sku_id) return { error: `Unknown SKU "${r.sku_code ?? r.sku ?? ''}"` }
            const whRaw = r.warehouse_code ?? r.warehouse
            const warehouse_id = whRaw ? w(whRaw) : null; if (whRaw && !warehouse_id) return { error: `Unknown warehouse "${whRaw}"` }
            const qty = toNum(r.qty ?? r.units ?? r.quantity); if (!qty || isNaN(qty) || qty <= 0) return { error: 'qty must be > 0' }
            const condition = (r.condition || 'sellable').trim().toLowerCase().replace(' ', '_'); if (!CONDITIONS.includes(condition)) return { error: `Bad condition "${r.condition}"` }
            const refund = toNum(r.refund_value ?? r.refund ?? r.value); if (refund != null && isNaN(refund)) return { error: 'refund_value is not a number' }
            return { record: { return_date: date, channel_id, sku_id, warehouse_id, qty, condition, reason: r.reason || null, refund_value: refund, order_ref: r.order_ref || r.order_id || null } }
          }}
          save={async recs => { const { error } = await supabase.from('returns').insert(recs); if (error) throw error }}
          onClose={() => setModal(null)} onDone={n => { toast(`${n} returns imported`); load() }} />
      })()}
    </>
  )
}

function ReturnForm({ r, onClose, onDone }: { r: Ret | null; onClose: () => void; onDone: () => void }) {
  const { channels, warehouses, toast } = useApp()
  const [f, setF] = useState({
    return_date: r?.return_date ?? today(), channel_id: r?.channel_id ?? channels.find(c => c.active)?.id ?? '', sku_id: r?.sku_id ?? '',
    warehouse_id: r?.warehouse_id ?? warehouses.find(w => w.active && w.kind === 'own')?.id ?? '', qty: r ? String(r.qty) : '',
    condition: r?.condition ?? 'sellable', reason: r?.reason ?? '', refund_value: r?.refund_value == null ? '' : String(r.refund_value), order_ref: r?.order_ref ?? '' })
  const save = async () => {
    if (!f.channel_id || !f.sku_id || !Number(f.qty)) return toast('Channel, SKU and qty are required', 'err')
    const rec = { ...f, qty: Number(f.qty), refund_value: f.refund_value === '' ? null : Number(f.refund_value), warehouse_id: f.warehouse_id || null, reason: f.reason || null, order_ref: f.order_ref || null }
    const { error } = r ? await supabase.from('returns').update(rec).eq('id', r.id) : await supabase.from('returns').insert(rec)
    if (error) return toast(error.message, 'err')
    onDone()
  }
  return (
    <Modal title={r ? 'Edit return' : 'Add return'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.return_date} onChange={e => setF({ ...f, return_date: e.target.value })} /></Field>
        <Field label="Channel"><select value={f.channel_id} onChange={e => setF({ ...f, channel_id: e.target.value })}>{channels.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="SKU"><SkuSelect value={f.sku_id} onChange={v => setF({ ...f, sku_id: v })} /></Field>
        <Field label="Qty"><input type="number" min={1} value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Condition"><select value={f.condition} onChange={e => setF({ ...f, condition: e.target.value })}>{CONDITIONS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></Field>
        <Field label="Received at" hint="Sellable returns are restocked here"><select value={f.warehouse_id} onChange={e => setF({ ...f, warehouse_id: e.target.value })}>
          <option value="">— not received —</option>{warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Reason"><input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label="Refund (₹)"><input type="number" value={f.refund_value} onChange={e => setF({ ...f, refund_value: e.target.value })} /></Field>
        <Field label="Order ref"><input value={f.order_ref} onChange={e => setF({ ...f, order_ref: e.target.value })} /></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  )
}
