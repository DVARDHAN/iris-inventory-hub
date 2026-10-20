import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtNum, fmtDate, today, parseDate, downloadCSV } from '../lib/format'
import { PageHead, Empty, Modal, Field } from '../components/ui'
import { CsvImport, lookup, toNum } from '../components/CsvImport'

type Loc = { sku_id: string; warehouse_id: string; sku_code: string; sku_name: string; warehouse_code: string; warehouse_name: string; on_hand: number; last_movement: string }
type Led = { id: number; txn_date: string; sku_id: string; warehouse_id: string; qty: number; txn_type: string; reference: string | null; note: string | null; source_table: string | null }
const MANUAL_TYPES = ['inward', 'opening', 'adjustment', 'damage'] as const

export default function Inventory() {
  const { skus, warehouses, canWrite, toast } = useApp()
  const [tab, setTab] = useState<'stock' | 'moves'>('stock')
  const [locs, setLocs] = useState<Loc[]>([])
  const [moves, setMoves] = useState<Led[]>([])
  const [q, setQ] = useState('')
  const [whFilter, setWhFilter] = useState('')
  const [modal, setModal] = useState<'move' | 'transfer' | 'import' | null>(null)
  const skuMap = useMemo(() => new Map(skus.map(s => [s.id, s])), [skus])
  const whMap = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const load = async () => {
    const [l, m] = await Promise.all([
      fetchAll<Loc>((a, b) => supabase.from('v_stock_by_location').select('*').range(a, b)),
      supabase.from('inventory_ledger').select('*').order('created_at', { ascending: false }).limit(400),
    ])
    setLocs(l); setMoves((m.data as Led[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const activeWh = warehouses.filter(w => w.active && (!whFilter || w.id === whFilter))
  const matrix = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const bySku = new Map<string, { code: string; name: string; cells: Record<string, number>; total: number }>()
    for (const l of locs) {
      if (qq && !l.sku_code.toLowerCase().includes(qq) && !l.sku_name.toLowerCase().includes(qq)) continue
      const r = bySku.get(l.sku_id) ?? { code: l.sku_code, name: l.sku_name, cells: {}, total: 0 }
      r.cells[l.warehouse_id] = Number(l.on_hand)
      if (!whFilter || l.warehouse_id === whFilter) r.total += Number(l.on_hand)
      bySku.set(l.sku_id, r)
    }
    return [...bySku.values()].filter(r => !whFilter || r.cells[whFilter] != null).sort((a, b) => a.code.localeCompare(b.code))
  }, [locs, q, whFilter])
  const whTotals = useMemo(() => {
    const t: Record<string, number> = {}
    matrix.forEach(r => Object.entries(r.cells).forEach(([w, v]) => t[w] = (t[w] ?? 0) + v))
    return t
  }, [matrix])

  return (
    <>
      <PageHead title="Stock & warehouses" desc="Live on-hand by SKU and location. Sales and sellable returns post automatically; use movements for inward, opening, adjustments and transfers.">
        <button className="btn ghost" onClick={() => downloadCSV('stock-by-location.csv', locs.map(l => ({ sku_code: l.sku_code, sku_name: l.sku_name, warehouse: l.warehouse_name, on_hand: l.on_hand, last_movement: l.last_movement })))}>Export CSV</button>
        {canWrite && <>
          <button className="btn ghost" onClick={() => setModal('import')}>Import CSV</button>
          <button className="btn ghost" onClick={() => setModal('transfer')}>Transfer</button>
          <button className="btn primary" onClick={() => setModal('move')}>Add movement</button>
        </>}
      </PageHead>

      <div className="chips">
        <button className={'chip' + (tab === 'stock' ? ' on' : '')} onClick={() => setTab('stock')}>Stock by location</button>
        <button className={'chip' + (tab === 'moves' ? ' on' : '')} onClick={() => setTab('moves')}>Recent movements</button>
      </div>

      {tab === 'stock' ? <>
        <div className="filters">
          <input type="search" placeholder="Search SKU or name…" value={q} onChange={e => setQ(e.target.value)} />
          <select value={whFilter} onChange={e => setWhFilter(e.target.value)}>
            <option value="">All warehouses</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <section className="card flush">
          {matrix.length === 0 ? <Empty>No stock recorded yet. Add warehouses and SKUs under “SKUs & masters”, then add opening stock.</Empty> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>SKU</th>{activeWh.map(w => <th key={w.id} className="r" title={w.name}>{w.code}</th>)}<th className="r">Total</th></tr></thead>
                <tbody>
                  {matrix.map(r => (
                    <tr key={r.code}>
                      <td><div className="mono">{r.code}</div><div className="small muted ellipsis" title={r.name}>{r.name}</div></td>
                      {activeWh.map(w => { const v = r.cells[w.id]; return <td key={w.id} className={'r' + (v != null && v <= 0 ? ' danger' : '')}>{v == null ? <span className="muted">·</span> : fmtNum(v)}</td> })}
                      <td className="r strong">{fmtNum(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td>{activeWh.map(w => <td key={w.id} className="r">{fmtNum(whTotals[w.id] ?? 0)}</td>)}<td className="r">{fmtNum(activeWh.reduce((a, w) => a + (whTotals[w.id] ?? 0), 0))}</td></tr></tfoot>
              </table>
            </div>
          )}
        </section>
      </> : (
        <section className="card flush">
          {moves.length === 0 ? <Empty>No movements yet.</Empty> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Type</th><th>SKU</th><th>Warehouse</th><th className="r">Qty</th><th>Reference / note</th></tr></thead>
                <tbody>{moves.map(m => (
                  <tr key={m.id}>
                    <td className="nowrap">{fmtDate(m.txn_date)}</td>
                    <td><span className="tag">{m.txn_type.replace('_', ' ')}</span></td>
                    <td className="mono">{skuMap.get(m.sku_id)?.sku_code}</td>
                    <td className="small">{whMap.get(m.warehouse_id)?.name}</td>
                    <td className={'r strong ' + (Number(m.qty) < 0 ? 'neg' : 'pos')}>{Number(m.qty) > 0 ? '+' : ''}{fmtNum(m.qty)}</td>
                    <td className="small muted">{[m.reference, m.note].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {modal === 'move' && <MoveModal onClose={() => setModal(null)} onDone={() => { setModal(null); toast('Movement saved'); load() }} />}
      {modal === 'transfer' && <TransferModal onClose={() => setModal(null)} onDone={() => { setModal(null); toast('Transfer saved'); load() }} />}
      {modal === 'import' && (() => {
        const sku = lookup(skus, 'sku_code'); const wh = lookup(warehouses, 'code', 'name')
        return <CsvImport title="Import stock movements"
          columns={['date', 'sku_code', 'warehouse_code', 'qty', 'type', 'reference', 'note']}
          sample={{ date: today(), sku_code: skus[0]?.sku_code ?? 'SKU-001', warehouse_code: warehouses[0]?.code ?? 'WH-01', qty: 100, type: 'opening', reference: 'Stock count', note: '' }}
          notes={['type: opening, inward, adjustment or damage (default inward).', 'For adjustment, a negative qty reduces stock; damage is always treated as a reduction.', 'Use this for opening stock or a full stock count.']}
          mapRow={r => {
            const date = parseDate(r.date) ?? today()
            const sku_id = sku(r.sku_code); if (!sku_id) return { error: `Unknown SKU "${r.sku_code}"` }
            const warehouse_id = wh(r.warehouse_code ?? r.warehouse); if (!warehouse_id) return { error: `Unknown warehouse "${r.warehouse_code ?? r.warehouse ?? ''}"` }
            const type = (r.type || 'inward').trim().toLowerCase()
            if (!MANUAL_TYPES.includes(type as any)) return { error: `Bad type "${r.type}"` }
            let qty = toNum(r.qty); if (qty == null || isNaN(qty) || qty === 0) return { error: 'qty must be a non-zero number' }
            if (type === 'damage') qty = -Math.abs(qty)
            if (type === 'inward' || type === 'opening') qty = Math.abs(qty)
            return { record: { txn_date: date, sku_id, warehouse_id, qty, txn_type: type, reference: r.reference || null, note: r.note || null } }
          }}
          save={async recs => { const { error } = await supabase.from('inventory_ledger').insert(recs); if (error) throw error }}
          onClose={() => setModal(null)} onDone={n => { toast(`${n} movements imported`); load() }} />
      })()}
    </>
  )
}

function MoveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { skus, warehouses, toast } = useApp()
  const [f, setF] = useState({ txn_date: today(), sku_id: '', warehouse_id: warehouses.find(w => w.active)?.id ?? '', txn_type: 'inward', qty: '', reference: '', note: '' })
  const save = async () => {
    let qty = Number(f.qty)
    if (!f.sku_id || !f.warehouse_id || !qty) return toast('SKU, warehouse and quantity are required', 'err')
    if (f.txn_type === 'damage') qty = -Math.abs(qty)
    if (f.txn_type === 'inward' || f.txn_type === 'opening') qty = Math.abs(qty)
    const { error } = await supabase.from('inventory_ledger').insert({ ...f, qty, reference: f.reference || null, note: f.note || null })
    if (error) return toast(error.message, 'err')
    onDone()
  }
  return (
    <Modal title="Add stock movement" onClose={onClose}>
      <div className="form-grid">
        <Field label="Type"><select value={f.txn_type} onChange={e => setF({ ...f, txn_type: e.target.value })}>
          <option value="inward">Inward (GRN / purchase)</option><option value="opening">Opening stock</option>
          <option value="adjustment">Adjustment (+/−)</option><option value="damage">Damage / write-off</option></select></Field>
        <Field label="Date"><input type="date" value={f.txn_date} onChange={e => setF({ ...f, txn_date: e.target.value })} /></Field>
        <Field label="SKU"><SkuSelect value={f.sku_id} onChange={v => setF({ ...f, sku_id: v })} /></Field>
        <Field label="Warehouse"><select value={f.warehouse_id} onChange={e => setF({ ...f, warehouse_id: e.target.value })}>
          {warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Quantity" hint={f.txn_type === 'adjustment' ? 'Use a negative number to reduce stock' : undefined}>
          <input type="number" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Reference"><input value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} placeholder="GRN / invoice no." /></Field>
        <Field label="Note"><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </div>
      {!skus.length && <p className="danger small">Add SKUs first under “SKUs & masters”.</p>}
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  )
}

function TransferModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { warehouses, toast } = useApp()
  const act = warehouses.filter(w => w.active)
  const [f, setF] = useState({ sku: '', from: act[0]?.id ?? '', to: act[1]?.id ?? '', qty: '', date: today(), note: '' })
  const save = async () => {
    const { error } = await supabase.rpc('transfer_stock', { p_sku: f.sku, p_from: f.from, p_to: f.to, p_qty: Number(f.qty), p_date: f.date, p_note: f.note || null })
    if (error) return toast(error.message, 'err')
    onDone()
  }
  return (
    <Modal title="Transfer stock between warehouses" onClose={onClose}>
      <div className="form-grid">
        <Field label="SKU"><SkuSelect value={f.sku} onChange={v => setF({ ...f, sku: v })} /></Field>
        <Field label="Quantity"><input type="number" min={1} value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="From"><select value={f.from} onChange={e => setF({ ...f, from: e.target.value })}>{act.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="To"><select value={f.to} onChange={e => setF({ ...f, to: e.target.value })}>{act.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Note"><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Blinkit FC replenishment" /></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.sku || !Number(f.qty)} onClick={save}>Transfer</button></div>
    </Modal>
  )
}

export function SkuSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { skus } = useApp()
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— choose SKU —</option>
      {skus.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.sku_code} · {s.name}</option>)}
    </select>
  )
}
