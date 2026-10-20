const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const num1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })

export const fmtINR = (v: number | null | undefined) => (v == null ? '—' : inr.format(Number(v)))
export const fmtNum = (v: number | null | undefined) => (v == null ? '—' : num.format(Number(v)))
export const fmtNum1 = (v: number | null | undefined) => (v == null ? '—' : num1.format(Number(v)))
export const fmtCompactINR = (v: number) => {
  const n = Number(v)
  if (Math.abs(n) >= 1e7) return '₹' + num1.format(n / 1e7) + ' Cr'
  if (Math.abs(n) >= 1e5) return '₹' + num1.format(n / 1e5) + ' L'
  return inr.format(n)
}
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export const today = () => toISO(new Date())
export const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d) }
export function toISO(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, or Excel-style "12 Oct 2026". */
export function parseDate(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3]
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : toISO(d)
}

export function downloadCSV(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
