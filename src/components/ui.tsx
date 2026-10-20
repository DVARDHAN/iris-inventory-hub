import { ReactNode, useEffect } from 'react'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

const STATUS: Record<string, { cls: string; icon: string }> = {
  'Out of stock': { cls: 'critical', icon: '⛔' },
  Critical: { cls: 'critical', icon: '▲' },
  Reorder: { cls: 'warning', icon: '●' },
  Healthy: { cls: 'good', icon: '✓' },
  Overstock: { cls: 'serious', icon: '◆' },
  'Slow moving': { cls: 'muted', icon: '◔' },
  'Dead stock': { cls: 'muted', icon: '○' },
  'No activity': { cls: 'muted', icon: '–' },
  urgent: { cls: 'critical', icon: '▲' },
  high: { cls: 'serious', icon: '●' },
  normal: { cls: 'muted', icon: '·' },
  open: { cls: 'warning', icon: '●' },
  approved: { cls: 'info', icon: '✓' },
  ordered: { cls: 'info', icon: '→' },
  received: { cls: 'good', icon: '✓' },
  cancelled: { cls: 'muted', icon: '×' },
  sellable: { cls: 'good', icon: '✓' },
  damaged: { cls: 'serious', icon: '!' },
  lost: { cls: 'critical', icon: '×' },
  in_transit: { cls: 'info', icon: '→' },
}
export function Badge({ value }: { value: string }) {
  const s = STATUS[value] ?? { cls: 'muted', icon: '·' }
  const t = value.replace('_', ' ')
  const label = t.charAt(0).toUpperCase() + t.slice(1)
  return <span className={'badge ' + s.cls}><span aria-hidden>{s.icon}</span>{label}</span>
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

export function PageHead({ title, desc, children }: { title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {desc && <p className="muted">{desc}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
