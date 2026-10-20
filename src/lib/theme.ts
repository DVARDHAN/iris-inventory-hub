import { useEffect, useState } from 'react'

const KEYS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8', '--other',
  '--good', '--warning', '--serious', '--critical', '--muted-fill',
  '--text', '--text-2', '--text-3', '--grid', '--surface'] as const

function read() {
  const cs = getComputedStyle(document.documentElement)
  const o: Record<string, string> = {}
  for (const k of KEYS) o[k] = cs.getPropertyValue(k).trim()
  return o
}

/** Resolved chart colors that follow the light/dark theme. */
export function useChartColors() {
  const [c, setC] = useState(read)
  useEffect(() => {
    const update = () => setC(read())
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => { mo.disconnect(); mq.removeEventListener('change', update) }
  }, [])
  return {
    series: [c['--s1'], c['--s2'], c['--s3'], c['--s4'], c['--s5'], c['--s6'], c['--s7'], c['--s8']],
    other: c['--other'],
    status: { good: c['--good'], warning: c['--warning'], serious: c['--serious'], critical: c['--critical'], muted: c['--muted-fill'] },
    text: c['--text'], text2: c['--text-2'], text3: c['--text-3'], grid: c['--grid'], surface: c['--surface'],
  }
}
