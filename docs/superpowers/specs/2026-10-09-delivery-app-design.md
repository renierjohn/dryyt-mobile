# Dryyt Delivery App — Design

Date: 2026-10-09

## Goal

A simple delivery app with two order types and two user roles.

- **Pickup** — driver picks up an order from a store and delivers it to the customer.
  - **Food**: customer orders menu items (milk tea, burgers, any food) from a food store.
  - **Laundry**: customer has finished laundry at a laundry shop; driver brings it home.
- **Drop off** (laundry only) — driver collects laundry from the customer and drops it at a laundry shop the customer chose.

Roles: **customer** and **driver**, chosen at registration.

## Scope (v1)

In: email/password auth, seeded stores and menus, order placement, driver job board, status tracking via polling, cash on delivery.

Out: maps/GPS, in-app payment, push notifications, chat, ratings, store-owner/admin UI.

## Stack

- `worker/` — Cloudflare Worker, Hono, D1. Passwords hashed with PBKDF2 (Web Crypto). Sessions via JWT (`hono/jwt`), secret `JWT_SECRET` stored as a Wrangler secret. Schema and seed data as D1 migrations.
- Mobile — existing Expo Router app (`src/app`), TanStack Query (polling with `refetchInterval` 5000 ms), `expo-secure-store` for the token. API base URL from `EXPO_PUBLIC_API_URL`.

## Data model (D1)

| Table | Columns |
|---|---|
| `users` | id, email (unique), password_hash, name, phone, role (`customer`\|`driver`), created_at |
| `stores` | id, name, type (`food`\|`laundry`), address |
| `menu_items` | id, store_id, name, price — food stores only |
| `orders` | id, type (`pickup`\|`dropoff`), customer_id, driver_id (nullable), store_id, status, customer_address, notes, items_total, delivery_fee, created_at, updated_at |
| `order_items` | id, order_id, name, price, qty — snapshot at order time |

Money is stored as integer centavos. Currency: PHP (₱). Delivery fee is a flat ₱50 (`DELIVERY_FEE` var in `wrangler.jsonc`).

## Order rules

- Status flow: `pending` → `accepted` → `picked_up` → `delivered`. Customer may set `cancelled` only while `pending`.
- Pickup + food store: requires ≥1 item; `items_total` computed server-side from `menu_items`.
- Pickup + laundry store: no items, `items_total = 0`; notes hold claim ticket etc. Laundry bill is settled with the shop.
- Drop off: store must be `laundry`; no items; `items_total = 0`.
- Total shown = `items_total + delivery_fee`, paid cash to the driver.
- A driver may hold at most one active (`accepted`/`picked_up`) job.
- The assigned driver may release an `accepted` job back to `pending`. Drivers see `customer_phone` only on jobs assigned to them.
- Accept is atomic: `UPDATE orders SET driver_id=?, status='accepted' WHERE id=? AND status='pending'`; 0 rows changed → 409.
- Only the assigned driver can advance status, and only to the next valid status.

## API

All routes except `/auth/*` require `Authorization: Bearer <jwt>`. Errors return `{ "error": string }` with a 4xx status.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | {email, password, name, phone, role} → {token, user} |
| POST | `/auth/login` | — | {email, password} → {token, user} |
| GET | `/me` | any | current user |
| GET | `/stores?type=food\|laundry` | any | list |
| GET | `/stores/:id` | any | store + menu_items |
| POST | `/orders` | customer | {type, store_id, items?: [{menu_item_id, qty}], customer_address, notes} |
| GET | `/orders` | customer | own orders, newest first |
| GET | `/orders/:id` | customer (owner) / driver (assigned or pending) | order + items + driver name/phone |
| POST | `/orders/:id/cancel` | customer (owner) | pending only |
| GET | `/jobs/available` | driver | pending orders with store info |
| GET | `/jobs/active` | driver | current job or null |
| POST | `/jobs/:id/accept` | driver | atomic; 409 if taken or driver busy |
| POST | `/jobs/:id/status` | driver (assigned) | {status: `picked_up`\|`delivered`} |
| POST | `/jobs/:id/release` | driver (assigned) | accepted → pending, driver cleared; 409 once picked up |
| GET | `/jobs/history` | driver | delivered jobs |

## Mobile screens

The root `_layout` reads the token and `/me`, then redirects to `(auth)`, `(customer)`, or `(driver)`. Template demo screens are removed.

- `(auth)/login`, `(auth)/register` (role toggle)
- `(customer)` tabs:
  - **Home** — "Pickup" / "Drop off" buttons
  - **Orders** — own orders list
  - **Profile** — info + logout
- Pickup flow: choose Food/Laundry → store list → menu + cart (food) or notes (laundry) → address → confirm
- Drop off flow: laundry store list → address + notes → confirm
- `order/[id]` — status timeline, items, total, driver name/phone, cancel button; polls every 5 s
- `(driver)` tabs:
  - **Available** — polled open jobs, accept button
  - **Active** — current job: pickup/destination addresses, customer phone, total to collect, single next-step button
  - **History**
  - **Profile**

## Error handling

- API: validation → 400, auth → 401, wrong role/ownership → 403, missing → 404, conflicts (taken job, busy driver, invalid transition) → 409.
- App: shows `error` message inline/alert. A 401 clears the token and redirects to login.

## Testing

- Worker: Vitest + `@cloudflare/vitest-pool-workers` — register/login, order validation rules, price computation, accept race (second accept → 409), status transitions, cancel rules, role guards.
- Mobile: `tsc --noEmit`, `expo lint`, manual run against `wrangler dev`.

## Seed data

- 3 food stores (milk tea shop, burger place, one more) with 4–6 menu items each.
- 2 laundry shops.
