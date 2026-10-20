import { useState } from 'react'
import { supabase, Sku, Warehouse, Channel } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtINR, downloadCSV } from '../lib/format'
import { PageHead, Empty, Modal, Field } from '../components/ui'
import { CsvImport, toNum } from '../components/CsvImport'

export default function Masters() {
  const { skus, warehouses, channels, canWrite, toast, reloadMasters } = useApp()
  const [tab, setTab] = useState<'skus' | 'wh' | 'ch'>('skus')
  const [q, setQ] = useState('')
  const [editSku, setEditSku] = useState<Partial<Sku> | null>(null)
  const [editWh, setEditWh] = useState<Partial<Warehouse> | null>(null)
  const [editCh, setEditCh] = useState<Partial<Channel> | null>(null)
  const [importing, setImporting] = useState(false)
  const qq = q.trim().toLowerCase()
  const skuView = skus.filter(s => !qq || s.sku_code.toLowerCase().includes(qq) || s.name.toLowerCase().includes(qq) || (s.brand ?? '').toLowerCase().includes(qq))

  return (
    <>
      <PageHead title="SKUs & masters" desc="Products, warehouses and sales channels. Leave target cover or lead time blank to use the defaults in Settings.">
        {tab === 'skus' && <>
          <button className="btn ghost" onClick={() => downloadCSV('skus.csv', skus.map(({ id, created_at, ...s }: any) => s))}>Export CSV</button>
          {canWrite && <><button className="btn ghost" onClick={() => setImporting(true)}>Import CSV</button>
            <button className="btn primary" onClick={() => setEditSku({ active: true, moq: 0, case_pack: 1 })}>Add SKU</button></>}
        </>}
        {tab === 'wh' && canWrite && <button className="btn primary" onClick={() => setEditWh({ active: true, kind: 'own' })}>Add warehouse</button>}
        {tab === 'ch' && canWrite && <button className="btn primary" onClick={() => setEditCh({ active: true })}>Add channel</button>}
      </PageHead>
      <div className="chips">
        <button className={'chip' + (tab === 'skus' ? ' on' : '')} onClick={() => setTab('skus')}>SKUs <span>{skus.length}</span></button>
        <button className={'chip' + (tab === 'wh' ? ' on' : '')} onClick={() => setTab('wh')}>Warehouses <span>{warehouses.length}</span></button>
        <button className={'chip' + (tab === 'ch' ? ' on' : '')} onClick={() => setTab('ch')}>Channels <span>{channels.length}</span></button>
      </div>

      {tab === 'skus' && <>
        <div className="filters"><input type="search" placeholder="Search SKUs…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <section className="card flush">
          {skuView.length === 0 ? <Empty>No SKUs yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>SKU</th><th>Brand</th><th>Category</th><th className="r">MRP</th><th className="r">Unit cost</th><th className="r">Target cover</th><th className="r">Lead time</th><th className="r">MOQ</th><th className="r">Case pack</th><th>Active</th>{canWrite && <th />}</tr></thead>
              <tbody>{skuView.map(s => (
                <tr key={s.id} className={s.active ? '' : 'inactive'}>
                  <td><div className="mono">{s.sku_code}</div><div className="small muted ellipsis" title={s.name}>{s.name}</div></td>
                  <td>{s.brand}</td><td>{s.category}</td>
                  <td className="r">{fmtINR(s.mrp)}</td><td className="r">{fmtINR(s.unit_cost)}</td>
                  <td className="r">{s.target_cover_days ?? <span className="muted">default</span>}</td>
                  <td className="r">{s.lead_time_days ?? <span className="muted">default</span>}</td>
                  <td className="r">{s.moq}</td><td className="r">{s.case_pack}</td>
                  <td>{s.active ? 'Yes' : 'No'}</td>
                  {canWrite && <td><button className="btn ghost sm" onClick={() => setEditSku(s)}>Edit</button></td>}
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      </>}

      {tab === 'wh' && (
        <section className="card flush">
          {warehouses.length === 0 ? <Empty>No warehouses yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Code</th><th>Name</th><th>City</th><th>Type</th><th>Linked channel</th><th>Active</th>{canWrite && <th />}</tr></thead>
              <tbody>{warehouses.map(w => (
                <tr key={w.id} className={w.active ? '' : 'inactive'}>
                  <td className="mono">{w.code}</td><td>{w.name}</td><td>{w.city}</td>
                  <td>{({ own: 'Own', '3pl': '3PL', marketplace: 'Marketplace (FBA/FC)' } as any)[w.kind]}</td>
                  <td>{channels.find(c => c.id === w.channel_id)?.name ?? '—'}</td><td>{w.active ? 'Yes' : 'No'}</td>
                  {canWrite && <td><button className="btn ghost sm" onClick={() => setEditWh(w)}>Edit</button></td>}
                </tr>))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'ch' && (
        <section className="card flush">
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Code</th><th>Name</th><th>Active</th>{canWrite && <th />}</tr></thead>
            <tbody>{channels.map(c => (
              <tr key={c.id} className={c.active ? '' : 'inactive'}><td className="mono">{c.code}</td><td>{c.name}</td><td>{c.active ? 'Yes' : 'No'}</td>
                {canWrite && <td><button className="btn ghost sm" onClick={() => setEditCh(c)}>Edit</button></td>}</tr>))}</tbody>
          </table></div>
        </section>
      )}

      {editSku && <SkuForm s={editSku} onClose={() => setEditSku(null)} onDone={() => { setEditSku(null); reloadMasters(); toast('SKU saved') }} />}
      {editWh && <WhForm w={editWh} onClose={() => setEditWh(null)} onDone={() => { setEditWh(null); reloadMasters(); toast('Warehouse saved') }} />}
      {editCh && <ChForm c={editCh} onClose={() => setEditCh(null)} onDone={() => { setEditCh(null); reloadMasters(); toast('Channel saved') }} />}
      {importing && <CsvImport title="Import SKUs"
        columns={['sku_code', 'name', 'brand', 'category', 'mrp', 'unit_cost', 'target_cover_days', 'lead_time_days', 'moq', 'case_pack']}
        sample={{ sku_code: 'GZ-BOTTLE-1L', name: 'Steel Water Bottle 1L', brand: 'Gizga', category: 'Kitchen', mrp: 799, unit_cost: 280, target_cover_days: 90, lead_time_days: 30, moq: 100, case_pack: 24 }}
        notes={['Existing SKUs (same sku_code) are updated; new ones are created.', 'Blank target_cover_days / lead_time_days use the defaults in Settings.']}
        mapRow={r => {
          if (!r.sku_code?.trim()) return { error: 'sku_code is required' }
          if (!r.name?.trim()) return { error: 'name is required' }
          const n = (k: string) => { const v = toNum(r[k]); return v == null || isNaN(v) ? null : v }
          return { record: { sku_code: r.sku_code.trim(), name: r.name.trim(), brand: r.brand || null, category: r.category || null,
            mrp: n('mrp'), unit_cost: n('unit_cost'), target_cover_days: n('target_cover_days'), lead_time_days: n('lead_time_days'),
            moq: n('moq') ?? 0, case_pack: Math.max(1, n('case_pack') ?? 1), active: true } }
        }}
        save={async recs => { const { error } = await supabase.from('skus').upsert(recs, { onConflict: 'sku_code' }); if (error) throw error }}
        onClose={() => setImporting(false)} onDone={n => { toast(`${n} SKUs imported`); reloadMasters() }} />}
    </>
  )
}

function useSaver(table: string, onDone: () => void) {
  const { toast } = useApp()
  return async (row: any) => {
    const { id, created_at, ...rest } = row
    const { error } = id ? await supabase.from(table).update(rest).eq('id', id) : await supabase.from(table).insert(rest)
    if (error) return toast(error.message.includes('duplicate') ? 'That code already exists' : error.message, 'err')
    onDone()
  }
}

function SkuForm({ s, onClose, onDone }: { s: Partial<Sku>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ ...s })
  const save = useSaver('skus', onDone)
  const num = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value) })
  return (
    <Modal title={s.id ? 'Edit SKU' : 'Add SKU'} onClose={onClose}>
      <div className="form-grid">
        <Field label="SKU code"><input value={f.sku_code ?? ''} onChange={e => setF({ ...f, sku_code: e.target.value })} /></Field>
        <Field label="Name"><input value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Brand"><input value={f.brand ?? ''} onChange={e => setF({ ...f, brand: e.target.value || null })} /></Field>
        <Field label="Category"><input value={f.category ?? ''} onChange={e => setF({ ...f, category: e.target.value || null })} /></Field>
        <Field label="MRP (₹)"><input type="number" value={f.mrp ?? ''} onChange={num('mrp')} /></Field>
        <Field label="Unit cost (₹)"><input type="number" value={f.unit_cost ?? ''} onChange={num('unit_cost')} /></Field>
        <Field label="Target cover (days)" hint="Blank = default (90)"><input type="number" value={f.target_cover_days ?? ''} onChange={num('target_cover_days')} /></Field>
        <Field label="Lead time (days)" hint="Blank = default"><input type="number" value={f.lead_time_days ?? ''} onChange={num('lead_time_days')} /></Field>
        <Field label="MOQ"><input type="number" value={f.moq ?? 0} onChange={num('moq')} /></Field>
        <Field label="Case pack"><input type="number" min={1} value={f.case_pack ?? 1} onChange={num('case_pack')} /></Field>
        <Field label="Status"><select value={f.active ? '1' : '0'} onChange={e => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!f.sku_code || !f.name} onClick={() => save({ ...f, moq: f.moq ?? 0, case_pack: f.case_pack || 1 })}>Save</button></div>
    </Modal>
  )
}

function WhForm({ w, onClose, onDone }: { w: Partial<Warehouse>; onClose: () => void; onDone: () => void }) {
  const { channels } = useApp()
  const [f, setF] = useState<any>({ ...w })
  const save = useSaver('warehouses', onDone)
  return (
    <Modal title={w.id ? 'Edit warehouse' : 'Add warehouse'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Code" hint="Short code used in CSV imports, e.g. BHW-01"><input value={f.code ?? ''} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name"><input value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="City"><input value={f.city ?? ''} onChange={e => setF({ ...f, city: e.target.value || null })} /></Field>
        <Field label="Type"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
          <option value="own">Own warehouse</option><option value="3pl">3PL</option><option value="marketplace">Marketplace FC (FBA, Blinkit, etc.)</option></select></Field>
        <Field label="Linked channel" hint="For marketplace-held stock"><select value={f.channel_id ?? ''} onChange={e => setF({ ...f, channel_id: e.target.value || null })}>
          <option value="">—</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Status"><select value={f.active ? '1' : '0'} onChange={e => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.code || !f.name} onClick={() => save(f)}>Save</button></div>
    </Modal>
  )
}

function ChForm({ c, onClose, onDone }: { c: Partial<Channel>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ ...c })
  const save = useSaver('channels', onDone)
  return (
    <Modal title={c.id ? 'Edit channel' : 'Add channel'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Code"><input value={f.code ?? ''} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Name"><input value={f.name ?? ''} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Status"><select value={f.active ? '1' : '0'} onChange={e => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
      </div>
      <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.code || !f.name} onClick={() => save(f)}>Save</button></div>
    </Modal>
  )
}
