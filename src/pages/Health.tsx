import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, fetchAll, Health as H } from '../lib/supabase'
import { fmtNum, fmtNum1, fmtINR, fmtDate, downloadCSV } from '../lib/format'
import { useApp } from '../lib/store'
import { Badge, PageHead, Empty, Modal, Field } from '../components/ui'

const STATUSES = ['Out of stock', 'Critical', 'Reorder', 'Healthy', 'Overstock', 'Slow moving', 'Dead stock', 'No activity']
type SortKey = keyof H

export default function Health() {
  const { canWrite, toast, warehouses } = useApp()
  const [rows, setRows] = useState<H[]>([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'days_of_cover', dir: 1 })
  const [raiseFor, setRaiseFor] = useState<H | null>(null)

  const load = () => fetchAll<H>((a, b) => supabase.from('v_sku_health').select('*').range(a, b))
    .then(r => { setRows(r); setLoading(false) })
  useEffect(() => { load() }, [])

  const cats = useMemo(() => [...new Set(rows.map(r => r.category).filter(Boolean))] as string[], [rows])
  const counts = useMemo(() => { const c: Record<string, number> = {}; rows.forEach(r => c[r.health_status] = (c[r.health_status] ?? 0) + 1); return c }, [rows])

  const view = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return rows
      .filter(r => !status || r.health_status === status)
      .filter(r => !cat || r.category === cat)
      .filter(r => !qq || r.sku_code.toLowerCase().includes(qq) || r.name.toLowerCase().includes(qq) || (r.brand ?? '').toLowerCase().includes(qq))
      .sort((a, b) => {
        const av = a[sort.k] as any, bv = b[sort.k] as any
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return (typeof av === 'number' || !isNaN(Number(av)) ? Number(av) - Number(bv) : String(av).localeCompare(String(bv))) * sort.dir
      })
  }, [rows, status, cat, q, sort])

  const th = (k: SortKey, label: string, right = true) => (
    <th className={(right ? 'r ' : '') + 'sortable'} onClick={() => setSort(s => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : 1 }))}>
      {label}{sort.k === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )

  const raiseAll = async () => {
    const { data, error } = await supabase.rpc('raise_replenishment_requests', { p_source: 'manual' })
    if (error) return toast(error.message, 'err')
    toast(data ? `${data} replenishment request${data === 1 ? '' : 's'} raised` : 'No new requests needed — every SKU below target already has an open request')
    load()
  }

  return (
    <>
      <PageHead title="Inventory health" desc={`Cover = on hand ÷ avg. daily sell-out (net of sellable returns, last ${rows[0]?.velocity_window_days ?? 30} days). Target cover defaults to 90 days.`}>
        <button className="btn ghost" onClick={() => downloadCSV('inventory-health.csv', view.map(r => ({
          sku_code: r.sku_code, name: r.name, category: r.category, on_hand: r.on_hand, on_order: r.on_order,
          avg_daily_sales: Number(r.avg_daily_sales).toFixed(2), days_of_cover: r.days_of_cover, target_cover_days: r.target_cover_days,
          lead_time_days: r.lead_time_days, sold_30: r.sold_30, sold_90: r.sold_90, return_rate_90: r.return_rate_90,
          suggested_reorder_qty: r.suggested_reorder_qty, status: r.health_status, stock_value: r.stock_value })))}>Export CSV</button>
        {canWrite && <button className="btn primary" onClick={raiseAll}>Raise requests for all below target</button>}
      </PageHead>

      <div className="chips">
        <button className={'chip' + (!status ? ' on' : '')} onClick={() => setParams({})}>All <span>{rows.length}</span></button>
        {STATUSES.filter(s => counts[s]).map(s => (
          <button key={s} className={'chip' + (status === s ? ' on' : '')} onClick={() => setParams({ status: s })}>{s} <span>{counts[s]}</span></button>
        ))}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search SKU, name, brand…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>{cats.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <section className="card flush">
        {loading ? <div className="splash">Loading…</div> : view.length === 0 ? <Empty>No SKUs match.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                {th('sku_code', 'SKU', false)}
                {th('on_hand', 'On hand')}{th('on_order', 'On order')}{th('avg_daily_sales', 'Avg/day')}
                {th('days_of_cover', 'Cover (d)')}{th('target_cover_days', 'Target (d)')}{th('lead_time_days', 'Lead (d)')}
                {th('sold_30', 'Sold 30d')}{th('sold_90', 'Sold 90d')}{th('return_rate_90', 'Return %')}
                {th('suggested_reorder_qty', 'Suggested')}{th('health_status', 'Status', false)}
                {canWrite && <th />}
              </tr></thead>
              <tbody>{view.map(r => (
                <tr key={r.sku_id}>
                  <td><div className="mono">{r.sku_code}</div><div className="small muted ellipsis" title={r.name}>{r.name}</div></td>
                  <td className="r">{fmtNum(r.on_hand)}</td>
                  <td className="r">{Number(r.on_order) ? fmtNum(r.on_order) : '—'}</td>
                  <td className="r">{fmtNum1(r.avg_daily_sales)}</td>
                  <td className="r strong">{r.days_of_cover == null ? '—' : fmtNum(r.days_of_cover)}</td>
                  <td className="r">{r.target_cover_days}</td>
                  <td className="r">{r.lead_time_days}</td>
                  <td className="r">{fmtNum(r.sold_30)}</td>
                  <td className="r">{fmtNum(r.sold_90)}</td>
                  <td className="r">{r.return_rate_90 == null ? '—' : fmtNum1(r.return_rate_90) + '%'}</td>
                  <td className="r strong">{Number(r.suggested_reorder_qty) ? fmtNum(r.suggested_reorder_qty) : '—'}</td>
                  <td className="nowrap"><Badge value={r.health_status} />{['Dead stock', 'Slow moving'].includes(r.health_status) && <div className="small muted">{r.last_sale ? 'Last sale ' + fmtDate(r.last_sale) : 'Never sold'}</div>}</td>
                  {canWrite && <td><button className="btn ghost sm" onClick={() => setRaiseFor(r)}>Request</button></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <p className="small muted legend-note">
        <strong>Critical</strong>: cover below supplier lead time · <strong>Reorder</strong>: cover below target ·
        <strong> Overstock</strong>: cover above target × overstock multiple · <strong>Dead stock</strong>: stock but no sale in 90 days.
        Suggested qty = (avg/day × target) − on hand − on order, rounded up to case pack and at least MOQ.
      </p>
      {raiseFor && <RaiseModal h={raiseFor} warehouses={warehouses} onClose={() => setRaiseFor(null)} onDone={() => { setRaiseFor(null); toast('Request raised'); load() }} />}
    </>
  )
}

export function RaiseModal({ h, warehouses, onClose, onDone }: { h: H; warehouses: ReturnType<typeof useApp>['warehouses']; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp()
  const own = warehouses.filter(w => w.active)
  const [qty, setQty] = useState(String(Number(h.suggested_reorder_qty) || h.case_pack || 1))
  const [wh, setWh] = useState(own.find(w => w.kind === 'own')?.id ?? own[0]?.id ?? '')
  const [priority, setPriority] = useState(h.health_status === 'Out of stock' ? 'urgent' : h.health_status === 'Critical' ? 'high' : 'normal')
  const [notes, setNotes] = useState('')
  const [expected, setExpected] = useState('')
  const save = async () => {
    const { error } = await supabase.from('replenishment_requests').insert({
      sku_id: h.sku_id, warehouse_id: wh || null, suggested_qty: h.suggested_reorder_qty, requested_qty: Number(qty),
      priority, source: 'manual', on_hand_at_request: h.on_hand, ads_at_request: h.avg_daily_sales, cover_at_request: h.days_of_cover,
      expected_date: expected || null, notes: notes || null,
    })
    if (error) return toast(error.message, 'err')
    onDone()
  }
  return (
    <Modal title={`Raise replenishment · ${h.sku_code}`} onClose={onClose}>
      <p className="muted small">{h.name} — on hand {fmtNum(h.on_hand)}, on order {fmtNum(h.on_order)}, {fmtNum1(h.avg_daily_sales)}/day, cover {h.days_of_cover ?? '—'} days.
        Suggested: <strong>{fmtNum(h.suggested_reorder_qty)}</strong>{h.unit_cost ? ` (≈ ${fmtINR(Number(h.suggested_reorder_qty) * Number(h.unit_cost))} at cost)` : ''}.</p>
      <div className="form-grid">
        <Field label="Quantity"><input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} /></Field>
        <Field label="Deliver to"><select value={wh} onChange={e => setWh(e.target.value)}>{own.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Priority"><select value={priority} onChange={e => setPriority(e.target.value)}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option></select></Field>
        <Field label="Expected by"><input type="date" value={expected} onChange={e => setExpected(e.target.value)} /></Field>
        <Field label="Notes"><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Supplier, PO no., etc." /></Field>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!Number(qty)} onClick={save}>Raise request</button>
      </div>
    </Modal>
  )
}
