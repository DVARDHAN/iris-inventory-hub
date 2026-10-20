import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type Channel = { id: string; code: string; name: string; active: boolean }
export type Warehouse = {
  id: string; code: string; name: string; city: string | null
  kind: 'own' | '3pl' | 'marketplace'; channel_id: string | null; active: boolean
}
export type Sku = {
  id: string; sku_code: string; name: string; brand: string | null; category: string | null
  mrp: number | null; unit_cost: number | null; target_cover_days: number | null
  lead_time_days: number | null; moq: number; case_pack: number; active: boolean
}
export type Health = {
  sku_id: string; sku_code: string; name: string; brand: string | null; category: string | null
  unit_cost: number | null; moq: number; case_pack: number
  target_cover_days: number; lead_time_days: number; velocity_window_days: number
  on_hand: number; sold_30: number; sold_90: number; sales_value_90: number
  returned_90: number; last_sale: string | null; on_order: number; open_requests: number
  avg_daily_sales: number; days_of_cover: number | null; target_stock: number; net_need: number
  return_rate_90: number | null; suggested_reorder_qty: number; health_status: string; stock_value: number
}
export type Role = 'admin' | 'member' | 'viewer'

/** Fetch every row of a query, paging past the 1000-row API cap. */
export async function fetchAll<T>(build: (from: number, to: number) => any, page = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1)
    if (error) throw error
    out.push(...(data as T[]))
    if (!data || data.length < page) break
  }
  return out
}
