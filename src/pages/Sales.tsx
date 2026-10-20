import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtNum, fmtINR, fmtDate, today, daysAgo, parseDate, downloadCSV } from '../lib/format'
import { PageHead, Empty, Modal, Field, Kpi } from '../components/ui'
import { CsvImport, lookup, toNum } from '../components/CsvImport'
import { SkuSelect } from './Inventory'

type Sale = { id: string; sale_date: string; channel_id: string; sku_id: string; warehouse_id: string | null; qty: number; gross_value: number | null; order_ref: string | null }
const LIMIT = 1000

export default function Sales() {
  const { skus, channels, warehouses, canWrite, toast } = useApp()
  const [rows, setRows] = useState<Sale[]>([])
  const [total, setTotal] = useState(0)
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(today())
  const [ch, setCh] = useState('')
  const [sku, setSku] = useState('')
  const [modal, setModal] = useState<'add' | 'import' | null>(null)
  const skuMap = useMemo(() => new Map(skus.map(s => [s.id, s])), [skus])
  const chMap = useMemo(() => new Map(channels.map(c => [c.id, c])), [channels])
  const whMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const load = async () => {
    let qy = supabase.from('sales').select('*', { count: 'exact' }).gte('sale_date', from).lte('sale_date', to)
    if (ch) qy = qy.eq('channel_id', ch)
    if (sku) qy = qy.eq('sku_id', sku)
    const { data, count, error } = await qy.order('sale_date', { ascending: false }).order('created_at', { ascending: false }).limit(LIMIT)
    if (error) toast(error.message, 'err')
    setRows((data as Sale[]) ?? []); setTotal(count ?? 0)
  }
  useEffect(() => { load() }, [from, to, ch, sku])

  const units = rows.reduce((a, r) => a + Number(r.qty), 0)
  const value = rows.reduce((a, r) => a + Number(r.gross_value ?? 0), 0)
  const del = async (r: Sale) => {
    if (!confirm('Delete this sale? Stock will be added back.')) return
    const { error } = await supabase.from('sales').delete().eq('id', r.id)
    if (error) return toast(error.message, 'err')
    toast('Deleted'); load()
  }

  return (
    <>
      <PageHead title="Sales" desc="Sell-out by portal. When a warehouse is given, stock is deducted from it automatically.">
        <button className="btn ghost" onClick={() => downloadCSV('sales.csv', rows.map(r => ({ date: r.sale_date, channel: chMap.get(r.channel_id)?.name, sku_code: skuMap.get(r.sku_id)?.sku_code, warehouse: r.warehouse_id ? whMap.get(r.warehouse_id)?.code : '', qty: r.qty, value: r.gross_value, order_ref: r.order_ref })))}>Export CSV</button>
        {canWrite && <><button className="btn ghost" onClick={() => setModal('import')}>Import CSV</button><button className="btn primary" onClick={() => setModal('add')}>Add sale</button></>}
      </PageHead>
      <div className="filters">
        <label className="inline">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <select value={ch} onChange={e => setCh(e.target.value)}><option value="">All channels</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <div style={{ minWidth: 220 }}><SkuSelect value={sku} onChange={setSku} /></div>
      </div>
      <div className="kpis three">
        <Kpi label="Units" value={fmtNum(units)} />
        <Kpi label="Gross value" value={fmtINR(value)} />
        <Kpi label="Lines" value={fmtNum(total)} sub={total > LIMIT ? `Showing latest ${LIMIT}` : undefined} />
      </div>
      <section className="card flush">
        {rows.length === 0 ? <Empty>No sales in this range.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Channel</th><th>SKU</th><th>Warehouse</th><th className="r">Qty</th><th className="r">Value</th><th>Order ref</th>{canWrite && <th />}</tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDate(r.sale_date)}</td>
                  <td>{chMap.get(r.channel_id)?.name}</td>
                  <td><span className="mono">{skuMap.get(r.sku_id)?.sku_code}</span></td>
                  <td className="small">{r.warehouse_id ? whMap.get(r.warehouse_id)?.code : <span className="muted">—</span>}</td>
                  <td className="r">{fmtNum(r.qty)}</td>
                  <td className="r">{fmtINR(r.gross_value)}</td>
                  <td className="small muted">{r.order_ref}</td>
                  {canWrite && <td><button className="icon-btn sm" title="Delete" aria-label="Delete" onClick={() => del(r)}>×</button></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {modal === 'add' && <AddSale onClose={() => setModal(null)} onDone={() => { setModal(null); toast('Sale saved'); load() }} />}
      {modal === 'import' && (() => {
        const s = lookup(skus, 'sku_code'); const c = lookup(channels, 'code', 'name'); const w = lookup(warehouses, 'code', 'name')
        return <CsvImport title="Import sales"
          columns={['date', 'channel', 'sku_code', 'warehouse_code', 'qty', 'value', 'order_ref']}
          sample={{ date: today(), channel: 'AMAZON', sku_code: skus[0]?.sku_code ?? 'SKU-001', warehouse_code: warehouses[0]?.code ?? '', qty: 3, value: 2397, order_ref: '' }}
          notes={['channel: code or name, e.g. AMAZON, FLIPKART, BLINKIT, INSTAMART, CRED, ZEPTO.', 'warehouse_code is optional — leave blank if the stock is not tracked here (e.g. marketplace-held stock you don’t track).', 'Tip: aggregate portal reports to one row per date × SKU × channel for speed.']}
          mapRow={r => {
            const date = parseDate(r.date ?? r.sale_date); if (!date) return { error: `Bad date "${r.date ?? ''}"` }
            const channel_id = c(r.channel ?? r.channel_code ?? r.portal); if (!channel_id) return { error: `Unknown channel "${r.channel ?? r.portal ?? ''}"` }
            const sku_id = s(r.sku_code ?? r.sku); if (!sku_id) return { error: `Unknown SKU "${r.sku_code ?? r.sku ?? ''}"` }
            const whRaw = r.warehouse_code ?? r.warehouse
            const warehouse_id = whRaw ? w(whRaw) : null; if (whRaw && !warehouse_id) return { error: `Unknown warehouse "${whRaw}"` }
            const qty = toNum(r.qty ?? r.units ?? r.quantity); if (!qty || isNaN(qty) || qty <= 0) return { error: 'qty must be > 0' }
            const value = toNum(r.value ?? r.gross_value ?? r.amount); if (value != null && isNaN(value)) return { error: 'value is not a number' }
            return { record: { sale_date: date, channel_id, sku_id, warehouse_id, qty, gross_value: value, order_ref: r.order_ref || r.order_id || null } }
          }}
          save={async recs => { const { error } = await supabase.from('sales').insert(recs); if (error) throw error }}
          onClose={() => setModal(null)} onDone={n => { toast(`${n} sales imported`); load() }} />
      })()}
    </>
  )
}

function AddSale({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { channels, warehouses, skus, toast } = useApp()
  const [f, setF] = useState({ sale_date: today(), channel_id: channels.find(c => c.active)?.id ?? '', sku_id: '', warehouse_id: '', qty: '', gross_value: '', order_ref: '' })
  const sku = skus.find(s => s.id === f.sku_id)
  const save = async () => {
    if (!f.channel_id || !f.sku_id || !Number(f.qty)) return toast('Channel, SKU and qty are required', 'err')
    const { error } = await supabase.from('sales').insert({ ...f, qty: Number(f.qty), gross_value: f.gross_value === '' ? null : Number(f.gross_value), warehouse_id: f.warehouse_id || null, order_ref: f.order_ref || null })
    if (error) return toast(error.message, 'err')
    onDone()
  }
  return (
    <Modal title="Add sale" onClose={onClose}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={f.sale_date} onChange={e => setF({ ...f, sale_date: e.target.value })} /></Field>
        <Field label="Channel"><select value={f.channel_id} onChange={e => setF({ ...f, channel_id: e.target.value })}>{channels.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="SKU"><SkuSelect value={f.sku_id} onChange={v => setF({ ...f, sku_id: v })} /></Field>
        <Field label="Ship-from warehouse" hint="Stock is deducted from here"><select value={f.warehouse_id} onChange={e => setF({ ...f, warehouse_id: e.target.value })}>
          <option value="">— not tracked —</option>{warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Qty"><input type="number" min={1} value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Gross value (₹)" hint={sku?.mrp && f.qty ? `MRP total ${fmtINR(Number(sku.mrp) * Number(f.qty))}` : undefined}>
          <input type="number" value={f.gross_value} onChange={e => setF({ ...f, gross_value: e.target.value })} /></Field>
        <Field label="Order ref"><input value={f.order_ref} onChange={e => setF({ ...f, order_ref: e.target.value })} /></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  )
}
