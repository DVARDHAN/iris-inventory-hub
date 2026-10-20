-- IRIS Inventory Hub — core schema
-- Ledger-based inventory: every stock change is a row in inventory_ledger.
-- Sales and sellable returns post to the ledger automatically via triggers.

create extension if not exists pgcrypto;

-- ───────────────────────── Access control ─────────────────────────
create table public.app_users (
  email      text primary key check (email = lower(email)),
  full_name  text,
  role       text not null default 'member' check (role in ('admin','member','viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users where email = lower(coalesce(auth.jwt()->>'email',''))
$$;

create or replace function public.is_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() is not null
$$;

create or replace function public.can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() in ('admin','member')
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role_name() = 'admin'
$$;

-- ───────────────────────── Masters ─────────────────────────
create table public.app_settings (
  key   text primary key,
  value numeric not null,
  label text
);
insert into public.app_settings(key, value, label) values
  ('velocity_window_days', 30, 'Sell-out window used for avg. daily sales (days)'),
  ('default_cover_days',   90, 'Default stock cover target (days)'),
  ('default_lead_time_days', 30, 'Default supplier lead time (days)'),
  ('overstock_multiple',    2, 'Overstock when cover exceeds target × this');

create table public.channels (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  name       text not null,
  city       text,
  kind       text not null default 'own' check (kind in ('own','3pl','marketplace')),
  channel_id uuid references public.channels(id),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.skus (
  id                uuid primary key default gen_random_uuid(),
  sku_code          text unique not null,
  name              text not null,
  brand             text,
  category          text,
  mrp               numeric(12,2),
  unit_cost         numeric(12,2),
  target_cover_days int,          -- null → app default (90)
  lead_time_days    int,          -- null → app default
  moq               int not null default 0,
  case_pack         int not null default 1 check (case_pack > 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ───────────────────────── Transactions ─────────────────────────
create table public.inventory_ledger (
  id           bigint generated always as identity primary key,
  txn_date     date not null default current_date,
  sku_id       uuid not null references public.skus(id),
  warehouse_id uuid not null references public.warehouses(id),
  qty          numeric(14,2) not null check (qty <> 0),
  txn_type     text not null check (txn_type in
                 ('opening','inward','sale','return','adjustment','transfer_in','transfer_out','damage')),
  source_table text,
  source_id    uuid,
  reference    text,
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.inventory_ledger(sku_id, warehouse_id);
create index on public.inventory_ledger(source_table, source_id);

create table public.sales (
  id           uuid primary key default gen_random_uuid(),
  sale_date    date not null,
  channel_id   uuid not null references public.channels(id),
  sku_id       uuid not null references public.skus(id),
  warehouse_id uuid references public.warehouses(id),   -- if set, stock is deducted
  qty          numeric(14,2) not null check (qty > 0),
  gross_value  numeric(14,2),
  order_ref    text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.sales(sale_date);
create index on public.sales(sku_id, sale_date);

create table public.returns (
  id           uuid primary key default gen_random_uuid(),
  return_date  date not null,
  channel_id   uuid not null references public.channels(id),
  sku_id       uuid not null references public.skus(id),
  warehouse_id uuid references public.warehouses(id),
  qty          numeric(14,2) not null check (qty > 0),
  condition    text not null default 'sellable' check (condition in ('sellable','damaged','lost','in_transit')),
  reason       text,
  refund_value numeric(14,2),
  order_ref    text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.returns(return_date);
create index on public.returns(sku_id, return_date);

create table public.replenishment_requests (
  id                uuid primary key default gen_random_uuid(),
  request_no        bigint generated always as identity,
  sku_id            uuid not null references public.skus(id),
  warehouse_id      uuid references public.warehouses(id),
  suggested_qty     numeric(14,2) not null default 0,
  requested_qty     numeric(14,2) not null,
  received_qty      numeric(14,2) not null default 0,
  priority          text not null default 'normal' check (priority in ('urgent','high','normal')),
  status            text not null default 'open' check (status in ('open','approved','ordered','received','cancelled')),
  source            text not null default 'manual' check (source in ('auto','manual')),
  on_hand_at_request numeric(14,2),
  ads_at_request     numeric(14,4),
  cover_at_request   numeric(14,1),
  expected_date     date,
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.replenishment_requests(status);

-- ───────────────────────── Ledger sync triggers ─────────────────────────
create or replace function public.sync_sales_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from inventory_ledger where source_table = 'sales' and source_id = old.id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.warehouse_id is not null then
    insert into inventory_ledger(txn_date, sku_id, warehouse_id, qty, txn_type, source_table, source_id, reference, created_by)
    values (new.sale_date, new.sku_id, new.warehouse_id, -new.qty, 'sale', 'sales', new.id, new.order_ref, new.created_by);
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_sales_ledger after insert or update or delete on public.sales
for each row execute function public.sync_sales_ledger();

create or replace function public.sync_returns_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from inventory_ledger where source_table = 'returns' and source_id = old.id;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.warehouse_id is not null and new.condition = 'sellable' then
    insert into inventory_ledger(txn_date, sku_id, warehouse_id, qty, txn_type, source_table, source_id, reference, created_by)
    values (new.return_date, new.sku_id, new.warehouse_id, new.qty, 'return', 'returns', new.id, new.order_ref, new.created_by);
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_returns_ledger after insert or update or delete on public.returns
for each row execute function public.sync_returns_ledger();

-- When a replenishment request is marked received, post the received qty as inward stock.
-- Idempotent: posts only the difference between what should be in the ledger and what already is.
create or replace function public.sync_replenishment_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_posted numeric; v_target numeric;
begin
  new.updated_at := now();
  select coalesce(sum(qty),0) into v_posted from inventory_ledger
   where source_table = 'replenishment_requests' and source_id = new.id;
  v_target := case when new.status = 'received' and new.warehouse_id is not null then new.received_qty else 0 end;
  if v_target <> v_posted then
    insert into inventory_ledger(txn_date, sku_id, warehouse_id, qty, txn_type, source_table, source_id, reference, created_by)
    values (current_date, new.sku_id, coalesce(new.warehouse_id, old.warehouse_id), v_target - v_posted,
            case when v_target > v_posted then 'inward' else 'adjustment' end,
            'replenishment_requests', new.id, 'REQ-' || new.request_no, auth.uid());
  end if;
  return new;
end $$;

create trigger trg_repl_ledger before update on public.replenishment_requests
for each row execute function public.sync_replenishment_ledger();

-- ───────────────────────── Views ─────────────────────────
create or replace view public.v_stock_by_location with (security_invoker = true) as
select l.sku_id, l.warehouse_id, s.sku_code, s.name as sku_name, w.code as warehouse_code, w.name as warehouse_name,
       sum(l.qty) as on_hand, max(l.txn_date) as last_movement
from public.inventory_ledger l
join public.skus s on s.id = l.sku_id
join public.warehouses w on w.id = l.warehouse_id
group by l.sku_id, l.warehouse_id, s.sku_code, s.name, w.code, w.name;

create or replace view public.v_sku_health with (security_invoker = true) as
with p as (
  select
    coalesce(max(value) filter (where key='velocity_window_days'),30)::int  as w,
    coalesce(max(value) filter (where key='default_cover_days'),90)::int    as def_cover,
    coalesce(max(value) filter (where key='default_lead_time_days'),30)::int as def_lead,
    coalesce(max(value) filter (where key='overstock_multiple'),2)          as over_mult
  from public.app_settings
),
stock as (select sku_id, sum(qty) as on_hand from public.inventory_ledger group by sku_id),
sl as (
  select s.sku_id,
         sum(s.qty) filter (where s.sale_date > current_date - p.w)  as sold_w,
         sum(s.qty) filter (where s.sale_date > current_date - 30)   as sold_30,
         sum(s.qty) filter (where s.sale_date > current_date - 90)   as sold_90,
         sum(s.gross_value) filter (where s.sale_date > current_date - 90) as value_90,
         max(s.sale_date) as last_sale
  from public.sales s cross join p group by s.sku_id
),
rt as (
  select r.sku_id,
         sum(r.qty) filter (where r.return_date > current_date - p.w and r.condition='sellable') as sellable_ret_w,
         sum(r.qty) filter (where r.return_date > current_date - 90) as returned_90
  from public.returns r cross join p group by r.sku_id
),
oo as (
  select sku_id, sum(greatest(requested_qty - received_qty,0)) as on_order,
         count(*) filter (where status='open') as open_requests
  from public.replenishment_requests where status in ('open','approved','ordered') group by sku_id
),
base as (
  select k.id as sku_id, k.sku_code, k.name, k.brand, k.category, k.unit_cost, k.moq, k.case_pack,
         coalesce(k.target_cover_days, p.def_cover) as target_cover_days,
         coalesce(k.lead_time_days, p.def_lead)     as lead_time_days,
         p.w as velocity_window_days, p.over_mult,
         coalesce(st.on_hand,0) as on_hand,
         coalesce(sl.sold_30,0) as sold_30, coalesce(sl.sold_90,0) as sold_90, coalesce(sl.value_90,0) as sales_value_90,
         coalesce(rt.returned_90,0) as returned_90, sl.last_sale,
         coalesce(oo.on_order,0) as on_order, coalesce(oo.open_requests,0) as open_requests,
         greatest(coalesce(sl.sold_w,0) - coalesce(rt.sellable_ret_w,0),0)::numeric / p.w as avg_daily_sales
  from public.skus k cross join p
  left join stock st on st.sku_id = k.id
  left join sl on sl.sku_id = k.id
  left join rt on rt.sku_id = k.id
  left join oo on oo.sku_id = k.id
  where k.active
),
calc as (
  select b.*,
         case when b.avg_daily_sales > 0 then round(b.on_hand / b.avg_daily_sales, 1) end as days_of_cover,
         ceil(b.avg_daily_sales * b.target_cover_days) as target_stock,
         ceil(b.avg_daily_sales * b.target_cover_days) - b.on_hand - b.on_order as net_need,
         case when b.sold_90 > 0 then round(100.0 * b.returned_90 / b.sold_90, 1) end as return_rate_90
  from base b
)
select c.*,
  case when c.net_need > 0
       then greatest(c.moq, ceil(c.net_need / c.case_pack) * c.case_pack) else 0 end as suggested_reorder_qty,
  case
    when c.avg_daily_sales = 0 and c.on_hand > 0 and (c.last_sale is null or c.last_sale <= current_date - 90) then 'Dead stock'
    when c.avg_daily_sales = 0 and c.on_hand > 0 then 'Slow moving'
    when c.avg_daily_sales = 0 then 'No activity'
    when c.on_hand <= 0 then 'Out of stock'
    when c.days_of_cover < c.lead_time_days then 'Critical'
    when c.days_of_cover < c.target_cover_days then 'Reorder'
    when c.days_of_cover > c.target_cover_days * c.over_mult then 'Overstock'
    else 'Healthy'
  end as health_status,
  round(c.on_hand * coalesce(c.unit_cost,0), 2) as stock_value
from calc c;

create or replace view public.v_sales_daily with (security_invoker = true) as
select s.sale_date, s.channel_id, c.name as channel_name, sum(s.qty) as units, sum(coalesce(s.gross_value,0)) as value
from public.sales s join public.channels c on c.id = s.channel_id
group by s.sale_date, s.channel_id, c.name;

create or replace view public.v_returns_daily with (security_invoker = true) as
select r.return_date, r.channel_id, c.name as channel_name, r.condition, sum(r.qty) as units, sum(coalesce(r.refund_value,0)) as value
from public.returns r join public.channels c on c.id = r.channel_id
group by r.return_date, r.channel_id, c.name, r.condition;

create or replace view public.v_channel_summary_90 with (security_invoker = true) as
select c.id as channel_id, c.name as channel_name,
  coalesce((select sum(qty) from public.sales s where s.channel_id=c.id and s.sale_date > current_date-90),0) as units_sold_90,
  coalesce((select sum(gross_value) from public.sales s where s.channel_id=c.id and s.sale_date > current_date-90),0) as value_90,
  coalesce((select sum(qty) from public.returns r where r.channel_id=c.id and r.return_date > current_date-90),0) as units_returned_90
from public.channels c where c.active;

-- ───────────────────────── RPCs ─────────────────────────
create or replace function public.transfer_stock(p_sku uuid, p_from uuid, p_to uuid, p_qty numeric, p_date date default current_date, p_note text default null)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.can_write() then raise exception 'Not permitted'; end if;
  if p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_from = p_to then raise exception 'Source and destination must differ'; end if;
  insert into inventory_ledger(txn_date, sku_id, warehouse_id, qty, txn_type, note) values
    (p_date, p_sku, p_from, -p_qty, 'transfer_out', p_note),
    (p_date, p_sku, p_to,    p_qty, 'transfer_in',  p_note);
end $$;

create or replace function public.raise_replenishment_requests(p_source text default 'manual')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.can_write() then raise exception 'Not permitted'; end if;
  insert into replenishment_requests(sku_id, warehouse_id, suggested_qty, requested_qty, priority, source,
                                     on_hand_at_request, ads_at_request, cover_at_request, notes)
  select h.sku_id,
         (select w.id from warehouses w where w.kind='own' and w.active order by w.created_at limit 1),
         h.suggested_reorder_qty, h.suggested_reorder_qty,
         case h.health_status when 'Out of stock' then 'urgent' when 'Critical' then 'high' else 'normal' end,
         p_source, h.on_hand, round(h.avg_daily_sales,4), h.days_of_cover,
         'Auto: ' || h.health_status || ' — cover ' || coalesce(h.days_of_cover::text,'0') || 'd vs target ' || h.target_cover_days || 'd'
  from v_sku_health h
  where h.suggested_reorder_qty > 0
    and h.health_status in ('Out of stock','Critical','Reorder')
    and h.open_requests = 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- Admin user management (creates confirmed users directly; no email round-trip needed)
create or replace function public.admin_upsert_user(p_email text, p_password text, p_role text default 'member', p_name text default null)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_email text := lower(trim(p_email)); v_uid uuid;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_role not in ('admin','member','viewer') then raise exception 'Bad role'; end if;
  insert into public.app_users(email, role, full_name) values (v_email, p_role, p_name)
    on conflict (email) do update set role = excluded.role, full_name = coalesce(excluded.full_name, app_users.full_name);
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    if p_password is null or length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
    v_uid := gen_random_uuid();
    insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                           confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
            extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_name), now(), now(), '', '', '', '');
    insert into auth.identities(id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  elsif p_password is not null and length(p_password) > 0 then
    if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = v_uid;
  end if;
end $$;

-- ───────────────────────── RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['channels','warehouses','skus','inventory_ledger','sales','returns','replenishment_requests','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_allowed())', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write())', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write()) with check (public.can_write())', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write())', t||'_del', t);
  end loop;
end $$;

alter table public.app_users enable row level security;
create policy app_users_read on public.app_users for select to authenticated using (public.is_allowed());
create policy app_users_admin_ins on public.app_users for insert to authenticated with check (public.is_admin());
create policy app_users_admin_upd on public.app_users for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy app_users_admin_del on public.app_users for delete to authenticated using (public.is_admin());

revoke execute on function public.admin_upsert_user(text,text,text,text) from anon, public;
revoke execute on function public.raise_replenishment_requests(text) from anon, public;
revoke execute on function public.transfer_stock(uuid,uuid,uuid,numeric,date,text) from anon, public;
grant execute on function public.admin_upsert_user(text,text,text,text) to authenticated;
grant execute on function public.raise_replenishment_requests(text) to authenticated;
grant execute on function public.transfer_stock(uuid,uuid,uuid,numeric,date,text) to authenticated;

revoke execute on function public.can_write(), public.current_role_name(), public.is_admin(), public.is_allowed() from anon, public;
grant execute on function public.can_write(), public.current_role_name(), public.is_admin(), public.is_allowed() to authenticated;
revoke execute on function public.sync_sales_ledger(), public.sync_returns_ledger(), public.sync_replenishment_ledger() from anon, authenticated, public;

-- ───────────────────────── Daily auto-replenishment (02:30 UTC = 08:00 IST) ─────────────────────────
create extension if not exists pg_cron;
select cron.schedule('daily-auto-replenishment', '30 2 * * *', $$select public.raise_replenishment_requests('auto')$$);

-- ───────────────────────── Seed channels ─────────────────────────
insert into public.channels(code, name) values
  ('AMAZON','Amazon'), ('FLIPKART','Flipkart'), ('BLINKIT','Blinkit'), ('INSTAMART','Swiggy Instamart'),
  ('CRED','CRED'), ('ZEPTO','Zepto'), ('BIGBASKET','BigBasket'), ('JIOMART','JioMart'), ('D2C','Own Website / D2C');
