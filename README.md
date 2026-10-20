# IRIS Inventory Hub

Multi-warehouse inventory, marketplace sell-out, returns, inventory health and 90-day replenishment — built on **Supabase** (Postgres + Auth) and a **React/Vite** front end deployed on **Vercel**.

## What it does

| Area | How it works |
|---|---|
| **Inventory by warehouse (SKU-wise)** | Every stock change is a row in `inventory_ledger` (opening, inward, sale, return, adjustment, damage, transfer). On-hand = sum of the ledger per SKU × warehouse (`v_stock_by_location`). |
| **Sales by portal** | `sales` rows per date × channel × SKU (Amazon, Flipkart, Blinkit, Swiggy Instamart, CRED, Zepto, BigBasket, JioMart, D2C — add more in Masters). If a ship-from warehouse is set, a trigger deducts stock. |
| **Returns by portal** | `returns` rows with condition `sellable / damaged / lost / in_transit`. Only *sellable* returns with a receiving warehouse go back into stock. |
| **Inventory health** | `v_sku_health`: avg. daily sell-out (net of sellable returns over a configurable window, default 30 days), days of cover, return rate, and a status: Out of stock · Critical (cover < lead time) · Reorder (cover < target) · Healthy · Overstock (cover > target × 2) · Slow moving · Dead stock (no sale in 90 days). |
| **90-day replenishment** | Suggested qty = avg/day × target cover (90 d default, per-SKU override) − on hand − on order, rounded up to case pack and at least MOQ. `raise_replenishment_requests()` creates requests for SKUs below target without an open request. It runs **daily at 08:00 IST** via `pg_cron`, and on demand from the app. Requests flow open → approved → ordered → received; receiving posts inward stock automatically. |

## Data entry
Manual forms, or CSV import on each page (templates downloadable in-app). Codes or names are accepted for channels and warehouses; dates may be `YYYY-MM-DD` or `DD/MM/YYYY`.

## Access
Invite-only. Admins add users (with a temporary password) under **Settings & users**. Roles: admin, member (read/write), viewer (read-only). Row-level security enforces this in the database.

## Local development
```bash
cp .env.example .env.local   # fill in the publishable key
npm install
npm run dev
```

## Database
Schema lives in `supabase/migrations/`. Demo data uses SKU and warehouse codes prefixed `DEMO-`; deactivate or delete them once real data is loaded.
