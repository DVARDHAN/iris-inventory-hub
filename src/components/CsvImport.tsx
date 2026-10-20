import { useState } from 'react'
import Papa from 'papaparse'
import { Modal } from './ui'
import { downloadCSV } from '../lib/format'

export type MapResult<T> = { record?: T; error?: string }

type Props<T> = {
  title: string
  columns: string[]
  sample: Record<string, string | number>
  notes?: string[]
  mapRow: (row: Record<string, string>) => MapResult<T>
  save: (records: T[]) => Promise<void>
  onClose: () => void
  onDone: (n: number) => void
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export function CsvImport<T>({ title, columns, sample, notes, mapRow, save, onClose, onDone }: Props<T>) {
  const [parsed, setParsed] = useState<{ ok: T[]; errors: { line: number; msg: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const onFile = (f: File) => {
    setErr('')
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: norm,
      complete: res => {
        const ok: T[] = []
        const errors: { line: number; msg: string }[] = []
        res.data.forEach((row, i) => {
          const r = mapRow(row)
          if (r.error) errors.push({ line: i + 2, msg: r.error })
          else if (r.record) ok.push(r.record)
        })
        setParsed({ ok, errors })
      },
      error: e => setErr(e.message),
    })
  }

  const run = async () => {
    if (!parsed?.ok.length) return
    setBusy(true); setErr('')
    try {
      for (let i = 0; i < parsed.ok.length; i += 500) await save(parsed.ok.slice(i, i + 500))
      onDone(parsed.ok.length)
      onClose()
    } catch (e: any) {
      setErr(e.message ?? String(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="muted">Upload a CSV with these columns (header names are case-insensitive):</p>
      <div className="code-cols">{columns.map(c => <code key={c}>{c}</code>)}</div>
      {notes && <ul className="notes">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
      <div className="row gap">
        <button className="btn ghost" onClick={() => downloadCSV(title.toLowerCase().replace(/\W+/g, '-') + '-template.csv', [sample])}>
          Download template
        </button>
        <label className="btn">
          Choose CSV file
          <input type="file" accept=".csv,text/csv" hidden onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </div>
      {parsed && (
        <div className="import-summary">
          <p><strong>{parsed.ok.length}</strong> rows ready to import{parsed.errors.length ? <>, <strong className="danger">{parsed.errors.length}</strong> rows skipped</> : null}.</p>
          {parsed.errors.length > 0 && (
            <div className="errlist">
              {parsed.errors.slice(0, 50).map(e => <div key={e.line}>Line {e.line}: {e.msg}</div>)}
              {parsed.errors.length > 50 && <div>…and {parsed.errors.length - 50} more</div>}
            </div>
          )}
        </div>
      )}
      {err && <p className="danger">{err}</p>}
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!parsed?.ok.length || busy} onClick={run}>
          {busy ? 'Importing…' : `Import ${parsed?.ok.length ?? ''} rows`}
        </button>
      </div>
    </Modal>
  )
}

/** Build lookup maps for code → id that accept code or name, case-insensitive. */
export function lookup<T extends { id: string }>(items: T[], ...keys: (keyof T)[]) {
  const m = new Map<string, string>()
  for (const it of items) for (const k of keys) {
    const v = it[k]
    if (v) m.set(String(v).trim().toLowerCase(), it.id)
  }
  return (v: string | undefined) => (v ? m.get(v.trim().toLowerCase()) : undefined)
}

export const toNum = (v: string | undefined) => {
  if (v == null || v.trim() === '') return null
  const n = Number(v.replace(/[₹,\s]/g, ''))
  return isNaN(n) ? NaN : n
}
