import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase, fetchAll, Health } from '../lib/supabase'
import { fmtCompactINR, fmtNum, fmtNum1, daysAgo, fmtDate, toISO } from '../lib/format'
import { useChartColors } from '../lib/theme'
import { Badge, Kpi, PageHead, Empty } from '../components/ui'

type Daily = { sale_date: string; channel_name: string; units: number; value: number }
type RetDaily = { return_date: string; channel_name: string; units: number; condition: string }

const STATUS_ORDER = ['Out of stock', 'Critical', 'Reorder', 'Healthy', 'Overstock', 'Slow moving', 'Dead stock', 'No activity']

export default function Dashboard() {
  const [health, setHealth] = useState<Health[]>([])
  const [daily, setDaily] = useState<Daily[]>([])
  const [rets, setRets] = useState<RetDaily[]>([])
  const [openReq, setOpenReq] = useState(0)
  const [metric, setMetric] = useState<'units' | 'value'>('units')
  const [loading, setLoading] = useState(true)
  const col = useChartColors()

  useEffect(() => {
    const since = daysAgo(89)
    Promise.all([
      fetchAll<Health>((a, b) => supabase.from('v_sku_health').select('*').range(a, b)),
      fetchAll<Daily>((a, b) => supabase.from('v_sales_daily').select('sale_date,channel_name,units,value').gte('sale_date', since).range(a, b)),
      fetchAll<RetDaily>((a, b) => supabase.from('v_returns_daily').select('return_date,channel_name,units,condition').gte('return_date', since).range(a, b)),
      supabase.from('replenishment_requests').select('id', { count: 'exact', head: true }).in('status', ['open', 'approved']),
    ]).then(([h, d, r, q]) => {
      setHealth(h); setDaily(d); setRets(r); setOpenReq(q.count ?? 0); setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const k = useMemo(() => {
    const d30 = daysAgo(29)
    const s30 = daily.filter(d => d.sale_date >= d30)
    const units30 = s30.reduce((a, d) => a + Number(d.units), 0)
    const value30 = s30.reduce((a, d) => a + Number(d.value), 0)
    const ret30 = rets.filter(r => r.return_date >= d30).reduce((a, r) => a + Number(r.units), 0)
    const onHand = health.reduce((a, h) => a + Math.max(0, Number(h.on_hand)), 0)
    const stockValue = health.reduce((a, h) => a + Math.max(0, Number(h.stock_value)), 0)
    const totalAds = health.reduce((a, h) => a + Number(h.avg_daily_sales), 0)
    const byStatus: Record<string, number> = {}
    health.forEach(h => { byStatus[h.health_status] = (byStatus[h.health_status] ?? 0) + 1 })
    return { units30, value30, ret30, onHand, stockValue, cover: totalAds ? onHand / totalAds : null, byStatus,
      retRate: units30 ? (100 * ret30) / units30 : null }
  }, [daily, rets, health])

  // Weekly stacked bars by channel — top 7 channels by volume, rest folded into "Other"
  const chart = useMemo(() => {
    const totals: Record<string, number> = {}
    daily.forEach(d => { totals[d.channel_name] = (totals[d.channel_name] ?? 0) + Number(d[metric]) })
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(x => x[0])
    const keep = ranked.slice(0, ranked.length > 8 ? 7 : 8)
    const keys = ranked.length > keep.length ? [...keep, 'Other'] : keep
    const weeks = new Map<string, Record<string, any>>()
    daily.forEach(d => {
      const dt = new Date(d.sale_date + 'T00:00:00')
      const monday = new Date(dt); monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
      const wk = toISO(monday)
      const row = weeks.get(wk) ?? { week: wk }
      const ch = keep.includes(d.channel_name) ? d.channel_name : 'Other'
      row[ch] = (row[ch] ?? 0) + Number(d[metric])
      weeks.set(wk, row)
    })
    return { keys, rows: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)) }
  }, [daily, metric])

  const channelTable = useMemo(() => {
    const m = new Map<string, { units: number; value: number; ret: number }>()
    daily.forEach(d => { const r = m.get(d.channel_name) ?? { units: 0, value: 0, ret: 0 }; r.units += Number(d.units); r.value += Number(d.value); m.set(d.channel_name, r) })
    rets.forEach(d => { const r = m.get(d.channel_name) ?? { units: 0, value: 0, ret: 0 }; r.ret += Number(d.units); m.set(d.channel_name, r) })
    return [...m.entries()].sort((a, b) => b[1].value - a[1].value)
  }, [daily, rets])

  const urgent = health.filter(h => ['Out of stock', 'Critical'].includes(h.health_status))
    .sort((a, b) => (a.days_of_cover ?? 0) - (b.days_of_cover ?? 0)).slice(0, 8)

  if (loading) return <div className="splash">Loading dashboard…</div>
  const colorFor = (key: string, i: number) => key === 'Other' ? col.other : col.series[i]

  return (
    <>
      <PageHead title="Dashboard" desc="Last 30 days unless noted. Stock cover uses the configured sell-out window." />
      <div className="kpis">
        <Kpi label="Units on hand" value={fmtNum(k.onHand)} sub={fmtCompactINR(k.stockValue) + ' at cost'} />
        <Kpi label="Network cover" value={k.cover == null ? '—' : fmtNum(k.cover) + ' days'} sub="On hand ÷ avg. daily sell-out" />
        <Kpi label="Units sold · 30d" value={fmtNum(k.units30)} sub={fmtCompactINR(k.value30) + ' gross'} />
        <Kpi label="Returns · 30d" value={fmtNum(k.ret30)} sub={k.retRate == null ? '—' : fmtNum1(k.retRate) + '% of units sold'} />
        <Kpi label="Need replenishment" value={fmtNum((k.byStatus['Out of stock'] ?? 0) + (k.byStatus['Critical'] ?? 0) + (k.byStatus['Reorder'] ?? 0))}
          sub={<Link to="/replenishment">{openReq} open request{openReq === 1 ? '' : 's'} →</Link>} tone="warn" />
      </div>

      <div className="grid-2">
        <section className="card span-2">
          <div className="card-head">
            <h2>Weekly sell-out by channel · 90 days</h2>
            <div className="seg" role="tablist">
              <button className={metric === 'units' ? 'on' : ''} onClick={() => setMetric('units')}>Units</button>
              <button className={metric === 'value' ? 'on' : ''} onClick={() => setMetric('value')}>Value (₹)</button>
            </div>
          </div>
          {chart.rows.length === 0 ? <Empty>No sales recorded in the last 90 days.</Empty> : (
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={chart.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke={col.grid} />
                  <XAxis dataKey="week" tickFormatter={w => fmtDate(w).slice(0, 6)} tick={{ fill: col.text3, fontSize: 12 }} axisLine={{ stroke: col.grid }} tickLine={false} />
                  <YAxis tick={{ fill: col.text3, fontSize: 12 }} axisLine={false} tickLine={false} width={64}
                    tickFormatter={v => metric === 'value' ? fmtCompactINR(v) : fmtNum(v)} />
                  <Tooltip cursor={{ fill: col.grid, opacity: 0.4 }}
                    contentStyle={{ background: col.surface, border: '1px solid ' + col.grid, borderRadius: 8, color: col.text }}
                    labelFormatter={w => 'Week of ' + fmtDate(String(w))}
                    formatter={(v: any, n: any) => [metric === 'value' ? fmtCompactINR(v) : fmtNum(v), n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} formatter={v => <span style={{ color: col.text2 }}>{v}</span>} />
                  {chart.keys.map((key, i) => (
                    <Bar key={key} dataKey={key} stackId="a" fill={colorFor(key, i)} stroke={col.surface} strokeWidth={1}
                      radius={i === chart.keys.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={40} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>SKU health</h2><Link to="/health" className="small">Open →</Link></div>
          <div className="health-bars">
            {STATUS_ORDER.filter(s => k.byStatus[s]).map(s => {
              const n = k.byStatus[s]; const pct = (100 * n) / health.length
              return (
                <Link to={'/health?status=' + encodeURIComponent(s)} key={s} className="hb-row">
                  <Badge value={s} />
                  <div className="hb-track"><div className={'hb-fill ' + statusClass(s)} style={{ width: pct + '%' }} /></div>
                  <span className="num">{n}</span>
                </Link>
              )
            })}
            {!health.length && <Empty>Add SKUs to see health.</Empty>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Act now</h2><Link to="/replenishment" className="small">Replenishment →</Link></div>
          {urgent.length === 0 ? <Empty>No SKUs are out of stock or below lead-time cover.</Empty> : (
            <table className="tbl compact">
              <thead><tr><th>SKU</th><th className="r">On hand</th><th className="r">Cover</th><th>Status</th></tr></thead>
              <tbody>{urgent.map(h => (
                <tr key={h.sku_id}><td><div className="mono">{h.sku_code}</div><div className="small muted ellipsis">{h.name}</div></td>
                  <td className="r">{fmtNum(h.on_hand)}</td><td className="r">{h.days_of_cover == null ? '—' : fmtNum(h.days_of_cover) + 'd'}</td>
                  <td><Badge value={h.health_status} /></td></tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section className="card span-2">
          <div className="card-head"><h2>Channels · 90 days</h2></div>
          {channelTable.length === 0 ? <Empty>No channel activity yet.</Empty> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Channel</th><th className="r">Units sold</th><th className="r">Gross value</th><th className="r">Units returned</th><th className="r">Return rate</th><th className="r">Share of value</th></tr></thead>
                <tbody>{(() => {
                  const tot = channelTable.reduce((a, [, r]) => a + r.value, 0)
                  return channelTable.map(([name, r]) => (
                    <tr key={name}><td>{name}</td><td className="r">{fmtNum(r.units)}</td><td className="r">{fmtCompactINR(r.value)}</td>
                      <td className="r">{fmtNum(r.ret)}</td><td className="r">{r.units ? fmtNum1((100 * r.ret) / r.units) + '%' : '—'}</td>
                      <td className="r"><div className="share"><div style={{ width: (tot ? (100 * r.value) / tot : 0) + '%' }} /></div>{tot ? fmtNum1((100 * r.value) / tot) : 0}%</td></tr>
                  ))
                })()}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

export function statusClass(s: string) {
  return ({ 'Out of stock': 'critical', Critical: 'critical', Reorder: 'warning', Healthy: 'good', Overstock: 'serious' } as Record<string, string>)[s] ?? 'muted'
}
