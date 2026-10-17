# Popular Menu + Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker-computed `popularity` on menu items, a "Popular now" row on customer Home, an item page with Add to cart, and a one-store cart that checks out through Pickup orders.

**Architecture:** Worker: migration adds `popularity` + `order_items.menu_item_id`; delivered jobs bump popularity in the same batch; new `GET /menu/popular` behind the Pickup gate. App: `CartProvider` context in the customer stack; `MenuItemCard`/`PopularRow`/`CartButton` components; new `popular`, `menu/[id]`, `cart` screens; store menu (`new-order.tsx`) writes to the cart.

**Tech Stack:** Cloudflare Worker (Hono, D1, zod, vitest-pool-workers), Expo SDK 57 / expo-router / TanStack Query / jest-expo + RNTL 14.

**Spec:** `docs/superpowers/specs/2026-10-17-popular-menu-cart-design.md`

## Global Constraints

- Prices in centavos; line price = `discountedPrice(item)` (app) / `discountedPrice(price, pct)` (worker).
- `popularity` is read-only: owners cannot set it (owner `menuItemSchema` unchanged — zod strips unknown keys).
- Popular list: food stores only, `ORDER BY popularity DESC, best_seller DESC, id DESC`, `limit` 1–50 default 4.
- `/menu/*` is behind the same `PICKUP_ENABLED` gate as `/orders` and `/jobs`.
- Cart: one store at a time; qty clamped 0–50; 0 removes the line; memory only.
- UI uses the revamp tokens/components (`useTheme`, `Card`, `Screen footer`, `StatusBadge`, `Button`) — no hex literals.
- Shell: worker commands run from `worker/` with `node_modules/.bin/vitest` and `node_modules/.bin/tsc`; app commands from repo root with `node_modules/.bin/{jest,tsc,expo}`. `npx`/`bun` are not on PATH.
- App `tsc` has 12 pre-existing errors in `scripts/apk-server.ts`; "tsc clean" means no others.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Double counting** — a retried/raced `delivered` call must not add popularity twice. Pinned in Task 2 (second delivered → 409, popularity unchanged).
2. **Deleted menu item still in an old order line** — popularity update must not fail delivery. `WHERE id IN (...)` simply matches nothing; pinned in Task 2 test "delivers even if an ordered item was deleted".
3. **Other-store add** — tapping + on store B with a store-A cart must ask before clearing. Pinned in Task 5 (`needs-replace`) and wired in Tasks 8–9 via `confirmReplace`.
4. **Cart for an item whose price changed** — checkout re-prices on the worker (existing `priceItems`); the cart total is only a preview. No test; reviewer to confirm no client price is sent.
5. **Empty/failed popular query** — Home hides the section. Pinned in Task 6 `PopularRow` test.

---

## File Map

| File | Change |
|---|---|
| `worker/migrations/0013_menu_popularity.sql` | New |
| `worker/src/types.ts` | `MenuItem.popularity`, `PopularItem` |
| `worker/src/lib/menu.ts` | select `popularity`; export generic `toItem` |
| `worker/src/routes/orders.ts` | store `menu_item_id` on lines |
| `worker/src/routes/jobs.ts` | bump popularity on delivered |
| `worker/src/routes/menu.ts` | New `GET /menu/popular` |
| `worker/src/index.ts` | mount `/menu` behind `pickupOnly` |
| `worker/wrangler.jsonc` | `PICKUP_ENABLED: "true"` |
| `worker/test/popularity.test.ts`, `worker/test/menu.test.ts` | New |
| `worker/test/stores.test.ts`, `owner-stores.test.ts`, `v2/pickup-off.test.ts` | Update for `popularity` / `/menu` |
| `src/constants/features.ts` | `PICKUP_ENABLED = true` |
| `src/lib/types.ts`, `src/hooks/queries.ts` | `popularity`, `PopularItem`, `usePopularMenu`, `MenuItemInput` |
| `src/hooks/use-cart.tsx` (+ test) | New cart context |
| `src/components/menu-item-card.tsx`, `popular-row.tsx`, `cart-button.tsx` (+ tests) | New |
| `src/app/customer/_layout.tsx` | `CartProvider`, new routes |
| `src/app/customer/(tabs)/index.tsx` | Popular row + cart button |
| `src/app/customer/popular.tsx`, `menu/[id].tsx`, `cart.tsx` | New |
| `src/app/customer/new-order.tsx` | Steppers use cart; footer "View cart" |

---

### Task 1: Migration, `popularity` on menu items

**Files:**
- Create: `worker/migrations/0013_menu_popularity.sql`, `worker/test/popularity.test.ts`
- Modify: `worker/src/types.ts` (`MenuItem`), `worker/src/lib/menu.ts`, `worker/test/stores.test.ts:35-43`, `worker/test/owner-stores.test.ts:173`

**Interfaces:**
- Produces: column `store_menu_items.popularity INTEGER NOT NULL DEFAULT 0`; column `order_items.menu_item_id INTEGER NULL`; worker `MenuItem.popularity: number`; `export function toItem<T extends MenuRow>(row: T): Omit<T, 'best_seller'> & { best_seller: boolean }`.

- [ ] **Step 1: Failing test** — `worker/test/popularity.test.ts`

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

const popularity = async (id: number) =>
  (await env.DB.prepare('SELECT popularity FROM store_menu_items WHERE id = ?').bind(id).first<{ popularity: number }>())!.popularity;

/** The migration's UPDATE statements, re-run against the current data. */
async function rerunBackfill() {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0013_'))!;
  for (const sql of migration.queries.filter((q) => q.trim().toUpperCase().startsWith('UPDATE'))) await env.DB.prepare(sql).run();
}

describe('menu popularity', () => {
  it('starts at 0 and is part of the menu', async () => {
    const { token } = await registerUser('customer');
    const menu = (await api('/stores/1', { token })).body.store.menu;
    expect(menu[0].popularity).toBe(0);
  });

  it('backfills from delivered order lines matched by store and name', async () => {
    const { token } = await registerUser('customer');
    const place = (qty: number) =>
      api('/orders', { token, body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 6, qty }], customer_address: '1 Customer St, Makati' } });
    const delivered = (await place(3)).body.order.id;
    const cancelled = (await place(5)).body.order.id;
    // Old data: lines without menu_item_id.
    await env.DB.batch([
      env.DB.prepare('UPDATE order_items SET menu_item_id = NULL'),
      env.DB.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").bind(delivered),
      env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(cancelled),
    ]);

    await rerunBackfill();

    expect(await popularity(6)).toBe(3);
    expect(await popularity(5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd worker && node_modules/.bin/vitest run test/popularity.test.ts` → `expected undefined to be 0` and `Cannot read properties of undefined (reading 'queries')`.

- [ ] **Step 3: Create `worker/migrations/0013_menu_popularity.sql`**

```sql
-- How many of this item customers have received (sum of qty on delivered orders). The worker keeps it current.
ALTER TABLE store_menu_items ADD COLUMN popularity INTEGER NOT NULL DEFAULT 0;
CREATE INDEX store_menu_items_popularity ON store_menu_items (popularity DESC);
-- Order lines snapshot name and price; this links them back to the menu item they came from.
ALTER TABLE order_items ADD COLUMN menu_item_id INTEGER REFERENCES store_menu_items(id);
-- Best effort for lines placed before this column: same store, same name.
UPDATE order_items SET menu_item_id = (
  SELECT m.id FROM store_menu_items m JOIN orders o ON o.id = order_items.order_id
  WHERE m.store_id = o.store_id AND m.name = order_items.name LIMIT 1
) WHERE menu_item_id IS NULL;
UPDATE store_menu_items SET popularity = COALESCE((
  SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.menu_item_id = store_menu_items.id AND o.status = 'delivered'
), 0);
```

- [ ] **Step 4: Worker types and menu select**

`worker/src/types.ts` — add to `MenuItem` after `best_seller: boolean;`:

```ts
  /** Units delivered; maintained by the worker, never set by owners. */
  popularity: number;
```

`worker/src/lib/menu.ts` — replace the select and `toItem`:

```ts
const MENU_SELECT = 'SELECT id, name, price, image_url, discount_percent, category, best_seller, popularity FROM store_menu_items';

export type MenuRow = Omit<MenuItem, 'best_seller'> & { best_seller: number };

/** D1 returns booleans as 0/1. Extra columns (e.g. the store's, on the popular list) pass through. */
export const toItem = <T extends MenuRow>({ best_seller, ...rest }: T): Omit<T, 'best_seller'> & { best_seller: boolean } => ({
  ...rest,
  best_seller: best_seller === 1,
});
```

- [ ] **Step 5: Existing exact-match tests** — `worker/test/stores.test.ts` add `popularity: 0,` after `best_seller: false,` in the `/stores/1` menu `toEqual`; `worker/test/owner-stores.test.ts:173` change to `expect(menu).toEqual([{ ...item, id: itemId, best_seller: false, image_url: null, popularity: 0 }]);`.

- [ ] **Step 6: Run, expect PASS** — `node_modules/.bin/vitest run && node_modules/.bin/vitest run -c vitest.v2.config.ts && node_modules/.bin/tsc --noEmit` (all from `worker/`).

- [ ] **Step 7: Commit**

```bash
git add worker/migrations/0013_menu_popularity.sql worker/src/types.ts worker/src/lib/menu.ts worker/test/popularity.test.ts worker/test/stores.test.ts worker/test/owner-stores.test.ts
git commit -m "Add menu item popularity column with backfill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Store `menu_item_id` on orders; bump popularity on delivered

**Files:**
- Modify: `worker/src/routes/orders.ts` (`Line`, `priceItems`, insert), `worker/src/routes/jobs.ts` (delivered batch)
- Test: `worker/test/popularity.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: every new `order_items` row has `menu_item_id`; delivering an order adds each line's qty to its item's `popularity` exactly once.

- [ ] **Step 1: Failing tests** — append inside the `describe` in `worker/test/popularity.test.ts`:

```ts
  async function deliveredOrder(items: { menu_item_id: number; qty: number }[]) {
    const customer = (await registerUser('customer')).token;
    const driver = (await registerUser('driver')).token;
    const id = (await api('/orders', { token: customer, body: { type: 'pickup', store_id: 2, items, customer_address: '1 Customer St, Makati' } })).body.order.id;
    await api(`/jobs/${id}/accept`, { token: driver, method: 'POST' });
    await api(`/jobs/${id}/status`, { token: driver, body: { status: 'picked_up' } });
    return { id, driver, deliver: () => api(`/jobs/${id}/status`, { token: driver, body: { status: 'delivered' } }) };
  }

  it('links new order lines to their menu item', async () => {
    const { token } = await registerUser('customer');
    const id = (await api('/orders', { token, body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 7, qty: 2 }], customer_address: '1 Customer St, Makati' } })).body.order.id;
    const line = await env.DB.prepare('SELECT menu_item_id FROM order_items WHERE order_id = ?').bind(id).first();
    expect(line).toEqual({ menu_item_id: 7 });
  });

  it('adds delivered quantities once', async () => {
    const order = await deliveredOrder([{ menu_item_id: 5, qty: 2 }, { menu_item_id: 7, qty: 1 }, { menu_item_id: 5, qty: 1 }]);
    expect(await popularity(5)).toBe(0);

    expect((await order.deliver()).status).toBe(200);
    expect(await popularity(5)).toBe(3);
    expect(await popularity(7)).toBe(1);

    expect((await order.deliver()).status).toBe(409);
    expect(await popularity(5)).toBe(3);
  });

  it('delivers even if an ordered item was deleted', async () => {
    const order = await deliveredOrder([{ menu_item_id: 8, qty: 1 }]);
    await env.DB.prepare('DELETE FROM store_menu_items WHERE id = 8').run();
    expect((await order.deliver()).status).toBe(200);
  });
```

- [ ] **Step 2: Run, expect FAIL** — `node_modules/.bin/vitest run test/popularity.test.ts` → `{ menu_item_id: null }` ≠ `{ menu_item_id: 7 }`, and `expected 0 to be 3`. If the deleted-item test fails on a FOREIGN KEY error at the `DELETE`, change that test's setup to `UPDATE order_items SET menu_item_id = 9999 WHERE order_id = ?` (bind `order.id`) instead of deleting — same effect (a line whose item no longer exists) — and record the ruling.

- [ ] **Step 3: `worker/src/routes/orders.ts`**
  - `type Line = { menuItemId: number; name: string; price: number; qty: number };`
  - In `priceItems` return: `return { menuItemId: item.id, name: item.name, price: discountedPrice(item.price, item.discount_percent), qty: i.qty };`
  - Line insert:

```ts
        .prepare(
          'INSERT INTO order_items (order_id, menu_item_id, name, price, qty) VALUES ((SELECT MAX(id) FROM orders WHERE customer_id = ?), ?, ?, ?, ?)',
        )
        .bind(customerId, l.menuItemId, l.name, l.price, l.qty),
```

- [ ] **Step 4: `worker/src/routes/jobs.ts`** — replace the delivered batch:

```ts
  // Delivered frees the driver and counts the items in the same batch, each guarded by the old state so they land only
  // with the status change (a repeated "delivered" changes nothing).
  const results =
    status === 'delivered'
      ? await db.batch([
          db.prepare('UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM orders WHERE id = ? AND status = ?)').bind(id, order.status),
          db
            .prepare(
              `UPDATE store_menu_items
               SET popularity = popularity + (SELECT SUM(qty) FROM order_items WHERE order_id = ?1 AND menu_item_id = store_menu_items.id)
               WHERE id IN (SELECT menu_item_id FROM order_items WHERE order_id = ?1) AND (SELECT status FROM orders WHERE id = ?1) = ?2`,
            )
            .bind(id, order.status),
          move,
        ])
      : [await move.run()];
```

(`results[results.length - 1]` is still `move`, so the 409 check is unchanged.)

- [ ] **Step 5: Run, expect PASS** — `node_modules/.bin/vitest run && node_modules/.bin/vitest run -c vitest.v2.config.ts && node_modules/.bin/tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/orders.ts worker/src/routes/jobs.ts worker/test/popularity.test.ts
git commit -m "Count delivered quantities into menu item popularity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /menu/popular`; Pickup on in the worker

**Files:**
- Create: `worker/src/routes/menu.ts`, `worker/test/menu.test.ts`
- Modify: `worker/src/types.ts`, `worker/src/index.ts:42-47`, `worker/wrangler.jsonc:9`, `worker/test/v2/pickup-off.test.ts`

**Interfaces:**
- Consumes: `toItem`, `MenuRow` (Task 1).
- Produces: `GET /menu/popular?limit=N` → `{ items: PopularItem[] }`; worker `type PopularItem = MenuItem & { store_id: number; store_name: string; store_logo: string | null }`.

- [ ] **Step 1: Failing test** — `worker/test/menu.test.ts`

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let token: string;

beforeEach(async () => {
  token = (await registerUser('customer')).token;
});

describe('popular menu', () => {
  it('requires auth', async () => {
    expect((await api('/menu/popular')).status).toBe(401);
  });

  it('sorts by popularity, then best seller, then newest; food only', async () => {
    await env.DB.batch([
      env.DB.prepare('UPDATE store_menu_items SET popularity = 5 WHERE id = 6'),
      env.DB.prepare('UPDATE store_menu_items SET popularity = 3 WHERE id = 2'),
      env.DB.prepare('UPDATE store_menu_items SET best_seller = 1 WHERE id = 9'),
      env.DB.prepare("INSERT INTO store_menu_items (store_id, name, price, popularity) VALUES (4, 'Wash & Fold', 9000, 99)"),
    ]);

    const res = await api('/menu/popular', { token });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([6, 2, 9, 12]);
    expect(res.body.items[0]).toMatchObject({ name: 'Cheeseburger', popularity: 5, best_seller: false, store_id: 2, store_name: 'Burger Barn', store_logo: null });
    expect(res.body.items[2].best_seller).toBe(true);
  });

  it('honours limit and rejects bad ones', async () => {
    expect((await api('/menu/popular?limit=10', { token })).body.items).toHaveLength(10);
    for (const bad of ['0', '51', 'abc', '2.5']) expect((await api(`/menu/popular?limit=${bad}`, { token })).status).toBe(400);
  });
});
```

Append to `worker/test/v2/pickup-off.test.ts` inside `refuses every Pickup route`:

```ts
    expect(await offline('/menu/popular', customer.token)).toEqual(off);
```

- [ ] **Step 2: Run, expect FAIL** — `node_modules/.bin/vitest run test/menu.test.ts` → 404s; `node_modules/.bin/vitest run -c vitest.v2.config.ts test/v2/pickup-off.test.ts` → 404 ≠ 403.

- [ ] **Step 3: `worker/src/types.ts`** — after `MenuItem`:

```ts
/** A menu item on the customers' popular list, with the store it comes from. */
export type PopularItem = MenuItem & { store_id: number; store_name: string; store_logo: string | null };
```

- [ ] **Step 4: Create `worker/src/routes/menu.ts`**

```ts
import { Hono } from 'hono';

import { requireAuth } from '../lib/auth';
import { fail } from '../lib/http';
import { toItem, type MenuRow } from '../lib/menu';
import type { AppEnv, PopularItem } from '../types';

const menu = new Hono<AppEnv>();
menu.use('*', requireAuth);

/** Food items customers order most, across all stores; best sellers then newest break ties (and fill in before any orders). */
menu.get('/popular', async (c) => {
  const limit = Number(c.req.query('limit') ?? 4);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail(400, 'limit must be a whole number from 1 to 50');

  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.name, m.price, m.image_url, m.discount_percent, m.category, m.best_seller, m.popularity,
            s.id AS store_id, s.name AS store_name, s.store_logo
     FROM store_menu_items m JOIN stores s ON s.id = m.store_id
     WHERE s.type = 'food'
     ORDER BY m.popularity DESC, m.best_seller DESC, m.id DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<MenuRow & Pick<PopularItem, 'store_id' | 'store_name' | 'store_logo'>>();
  return c.json({ items: results.map(toItem) });
});

export default menu;
```

- [ ] **Step 5: `worker/src/index.ts`** — add `import menu from './routes/menu';` with the other route imports, and next to the existing gate lines:

```ts
app.use('/menu', pickupOnly);
app.use('/menu/*', pickupOnly);
```

and `app.route('/menu', menu);` after `app.route('/jobs', jobs);`.

- [ ] **Step 6: `worker/wrangler.jsonc`** — `"PICKUP_ENABLED": "true",`. Update the comment in `vitest.shared.ts` from "Pickup is off in wrangler.jsonc" to "Pickup may be off in wrangler.jsonc".

- [ ] **Step 7: Run, expect PASS** — `node_modules/.bin/vitest run && node_modules/.bin/vitest run -c vitest.v2.config.ts && node_modules/.bin/tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add worker/src/routes/menu.ts worker/src/types.ts worker/src/index.ts worker/wrangler.jsonc worker/vitest.shared.ts worker/test/menu.test.ts worker/test/v2/pickup-off.test.ts
git commit -m "Add popular menu endpoint and switch Pickup on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: App types, query, Pickup on

**Files:**
- Modify: `src/lib/types.ts` (`MenuItem`), `src/hooks/queries.ts` (import, `MenuItemInput`, new hook), `src/constants/features.ts`

**Interfaces:**
- Produces: app `MenuItem.popularity: number`; `export type PopularItem = MenuItem & { store_id: number; store_name: string; store_logo: string | null }`; `export const usePopularMenu = (limit: number) => UseQueryResult<PopularItem[]>`; `MenuItemInput = Omit<MenuItem, 'id' | 'popularity'>`.

- [ ] **Step 1: `src/lib/types.ts`** — in `MenuItem` add after `best_seller: boolean;`:

```ts
  /** Units delivered; set by the worker. */
  popularity: number;
```

and after `StoreWithMenu`:

```ts
/** A menu item on the popular list, with its store. */
export type PopularItem = MenuItem & { store_id: number; store_name: string; store_logo: string | null };
```

- [ ] **Step 2: `src/hooks/queries.ts`** — add `PopularItem` to the `@/lib/types` import; change `export type MenuItemInput = Omit<MenuItem, 'id' | 'popularity'>;`; after `useStore` add:

```ts
/** Most-ordered food items across stores (`limit` 1–50). */
export const usePopularMenu = (limit: number) =>
  useQuery({
    queryKey: ['popular', limit],
    queryFn: () => api<{ items: PopularItem[] }>(`/menu/popular?limit=${limit}`).then((r) => r.items),
    enabled: PICKUP_ENABLED,
  });
```

- [ ] **Step 3: `src/constants/features.ts`** — `export const PICKUP_ENABLED = true;` and update the doc comment first sentence to: `Pickup (food/laundry from a store to the customer). Off hides its screens and skips its queries;`.

- [ ] **Step 4: Verify** — `node_modules/.bin/tsc --noEmit` (only apk-server errors) `&& node_modules/.bin/expo lint && node_modules/.bin/jest`. If `src/app/owner/menu-item.tsx` or `menu-editor.tsx` now fails typecheck because it spreads a full `MenuItem` into `MenuItemInput`, drop `popularity` there with `const { id, popularity, ...input } = item` style destructuring and record the ruling.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/hooks/queries.ts src/constants/features.ts
git commit -m "Add popular menu query and switch Pickup on in the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cart context

**Files:**
- Create: `src/hooks/use-cart.tsx`, `src/hooks/__tests__/use-cart.test.tsx`

**Interfaces:**
- Consumes: `MenuItem`, `discountedPrice`.
- Produces:
  - `type CartStore = { id: number; name: string }`; `type CartLine = { item: MenuItem; qty: number }`
  - `CartProvider({ children })`
  - `useCart(): { store: CartStore | null; lines: CartLine[]; count: number; itemsTotal: number; qtyOf(itemId: number): number; add(item, store, qty): 'added' | 'needs-replace'; replace(item, store, qty): void; setQty(itemId, qty): void; clear(): void }`
  - `confirmReplace(current: string, onConfirm: () => void)` — the Alert.

- [ ] **Step 1: Failing test** — `src/hooks/__tests__/use-cart.test.tsx`

```tsx
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { CartProvider, useCart } from '@/hooks/use-cart';
import type { MenuItem } from '@/lib/types';

const item = (id: number, price: number, discount_percent = 0): MenuItem => ({
  id, name: `Item ${id}`, price, discount_percent, image_url: null, category: '', best_seller: false, popularity: 0,
});
const tea = { id: 1, name: 'Tea Haven' };
const burger = { id: 2, name: 'Burger Barn' };
const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

it('adds items from one store and totals discounted prices', async () => {
  const { result } = await renderHook(() => useCart(), { wrapper });
  await act(() => {
    expect(result.current.add(item(1, 10000), tea, 2)).toBe('added');
    result.current.add(item(2, 5000, 20), tea, 1);
    result.current.add(item(1, 10000), tea, 1);
  });
  expect(result.current.store).toEqual(tea);
  expect(result.current.count).toBe(4);
  expect(result.current.qtyOf(1)).toBe(3);
  expect(result.current.itemsTotal).toBe(3 * 10000 + 4000);
});

it('asks before mixing stores, and replace starts over', async () => {
  const { result } = await renderHook(() => useCart(), { wrapper });
  await act(() => {
    result.current.add(item(1, 10000), tea, 1);
  });
  let outcome = '';
  await act(() => {
    outcome = result.current.add(item(5, 15000), burger, 1);
  });
  expect(outcome).toBe('needs-replace');
  expect(result.current.store).toEqual(tea);

  await act(() => result.current.replace(item(5, 15000), burger, 2));
  expect(result.current.store).toEqual(burger);
  expect(result.current.lines).toEqual([{ item: item(5, 15000), qty: 2 }]);
});

it('setQty clamps, removes at 0, and an empty cart has no store', async () => {
  const { result } = await renderHook(() => useCart(), { wrapper });
  await act(() => {
    result.current.add(item(1, 10000), tea, 1);
  });
  await act(() => result.current.setQty(1, 99));
  expect(result.current.qtyOf(1)).toBe(50);
  await act(() => result.current.setQty(1, 0));
  expect(result.current.lines).toEqual([]);
  expect(result.current.store).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL** — `node_modules/.bin/jest src/hooks` → `Cannot find module '@/hooks/use-cart'`.

- [ ] **Step 3: Create `src/hooks/use-cart.tsx`**

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { discountedPrice } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

export type CartStore = { id: number; name: string };
export type CartLine = { item: MenuItem; qty: number };
type Cart = { store: CartStore | null; lines: CartLine[] };

const MAX_QTY = 50;
const EMPTY: Cart = { store: null, lines: [] };
const clamp = (qty: number) => Math.min(MAX_QTY, Math.max(0, qty));

function useCartState() {
  const [cart, setCart] = useState<Cart>(EMPTY);

  return useMemo(() => {
    const addTo = (base: Cart, item: MenuItem, store: CartStore, qty: number): Cart => {
      const existing = base.lines.find((l) => l.item.id === item.id);
      const lines = existing
        ? base.lines.map((l) => (l.item.id === item.id ? { ...l, qty: clamp(l.qty + qty) } : l))
        : [...base.lines, { item, qty: clamp(qty) }];
      return { store, lines };
    };

    return {
      ...cart,
      count: cart.lines.reduce((sum, l) => sum + l.qty, 0),
      itemsTotal: cart.lines.reduce((sum, l) => sum + discountedPrice(l.item) * l.qty, 0),
      qtyOf: (itemId: number) => cart.lines.find((l) => l.item.id === itemId)?.qty ?? 0,
      /** One store per cart: from another store, nothing changes and the caller asks (see `confirmReplace`). */
      add: (item: MenuItem, store: CartStore, qty: number): 'added' | 'needs-replace' => {
        if (cart.store && cart.store.id !== store.id) return 'needs-replace';
        setCart((c) => addTo(c, item, store, qty));
        return 'added';
      },
      replace: (item: MenuItem, store: CartStore, qty: number) => setCart(addTo(EMPTY, item, store, qty)),
      setQty: (itemId: number, qty: number) =>
        setCart((c) => {
          const lines = c.lines.map((l) => (l.item.id === itemId ? { ...l, qty: clamp(qty) } : l)).filter((l) => l.qty > 0);
          return lines.length ? { ...c, lines } : EMPTY;
        }),
      clear: () => setCart(EMPTY),
    };
  }, [cart]);
}

const CartContext = createContext<ReturnType<typeof useCartState> | null>(null);

/** The customer's cart, shared by Home, the menu screens and checkout. Memory only. */
export function CartProvider({ children }: { children: ReactNode }) {
  return <CartContext.Provider value={useCartState()}>{children}</CartContext.Provider>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart needs a CartProvider');
  return cart;
}

/** Asks before an item from another store clears the cart. */
export function confirmReplace(current: string, onConfirm: () => void) {
  Alert.alert('Start a new cart?', `Your cart from ${current} will be cleared.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Start new cart', style: 'destructive', onPress: onConfirm },
  ]);
}
```

- [ ] **Step 4: Run, expect PASS** — `node_modules/.bin/jest src/hooks && node_modules/.bin/tsc --noEmit && node_modules/.bin/expo lint`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-cart.tsx src/hooks/__tests__/use-cart.test.tsx
git commit -m "Add one-store cart context

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `MenuItemCard`, `PopularRow`, `CartButton`

**Files:**
- Create: `src/components/menu-item-card.tsx`, `src/components/popular-row.tsx`, `src/components/cart-button.tsx`
- Test: `src/components/__tests__/menu-item-card.test.tsx`, `popular-row.test.tsx`

**Interfaces:**
- Consumes: `useCart`, `PopularItem`, `Icon`, tokens.
- Produces:
  - `MenuItemCard({ item: MenuItem; storeName?: string; onPress: () => void; compact?: boolean })` — `flex: 1`.
  - `PopularRow({ items: PopularItem[] | undefined; onSeeAll: () => void; onOpen: (item: PopularItem) => void })` — renders `null` when `items` is empty/undefined; at most 4 cards in one row.
  - `CartButton()` — floating pill, absolutely positioned bottom; `null` when cart empty.
  - `openMenuItem(item: { id: number; store_id: number })` helper exported from `menu-item-card.tsx` → `router.push({ pathname: '/customer/menu/[id]', params: { id, storeId } })`.

- [ ] **Step 1: Failing tests**

`src/components/__tests__/menu-item-card.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MenuItemCard } from '../menu-item-card';

jest.mock('../icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const item = { id: 6, name: 'Cheeseburger', price: 17000, discount_percent: 20, image_url: null, category: '', best_seller: false, popularity: 5 };

it('shows the discounted price, the original struck through, and the store', async () => {
  const onPress = jest.fn();
  await render(<MenuItemCard item={item} storeName="Burger Barn" onPress={onPress} />);
  expect(screen.getByText('₱136.00')).toBeTruthy();
  expect(screen.getByText('₱170.00')).toBeTruthy();
  expect(screen.getByText('Burger Barn')).toBeTruthy();
  await fireEvent.press(screen.getByText('Cheeseburger'));
  expect(onPress).toHaveBeenCalled();
});

it('shows one price when not discounted', async () => {
  await render(<MenuItemCard item={{ ...item, discount_percent: 0 }} onPress={() => {}} />);
  expect(screen.getByText('₱170.00')).toBeTruthy();
  expect(screen.queryByText('₱136.00')).toBeNull();
});
```

`src/components/__tests__/popular-row.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PopularRow } from '../popular-row';

jest.mock('../icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const make = (id: number) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, popularity: 0,
  store_id: 1, store_name: 'Tea Haven', store_logo: null,
});

it('renders nothing without items', async () => {
  await render(<PopularRow items={[]} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.queryByText('Popular now')).toBeNull();
  await render(<PopularRow items={undefined} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.queryByText('Popular now')).toBeNull();
});

it('shows at most 4 items and See all', async () => {
  const onSeeAll = jest.fn();
  await render(<PopularRow items={[1, 2, 3, 4, 5].map(make)} onSeeAll={onSeeAll} onOpen={() => {}} />);
  expect(screen.getByText('Dish 4')).toBeTruthy();
  expect(screen.queryByText('Dish 5')).toBeNull();
  await fireEvent.press(screen.getByText('See all'));
  expect(onSeeAll).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, expect FAIL** — `node_modules/.bin/jest src/components/__tests__/menu-item-card src/components/__tests__/popular-row` → module not found.

- [ ] **Step 3: Create `src/components/menu-item-card.tsx`**

```tsx
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

type Props = { item: MenuItem; storeName?: string; onPress: () => void; compact?: boolean };

export const openMenuItem = (item: { id: number; store_id: number }) =>
  router.push({ pathname: '/customer/menu/[id]', params: { id: String(item.id), storeId: String(item.store_id) } });

/** Photo, name, store and price; cards in a row share the width. */
export function MenuItemCard({ item, storeName, onPress, compact = false }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
          <Icon name={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} size={compact ? 20 : 28} color={theme.primary} />
        </View>
      )}
      <ThemedText type={compact ? 'small' : 'smallBold'} numberOfLines={2}>
        {item.name}
      </ThemedText>
      {storeName && (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={compact && styles.compactText}>
          {storeName}
        </ThemedText>
      )}
      <View style={styles.prices}>
        <ThemedText type="smallBold" style={compact && styles.compactText}>
          {peso(discountedPrice(item))}
        </ThemedText>
        {item.discount_percent > 0 && !compact && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.struck}>
            {peso(item.price)}
          </ThemedText>
        )}
      </View>
      {item.discount_percent > 0 && compact && (
        <ThemedText type="small" themeColor="textSecondary" style={[styles.struck, styles.compactText]}>
          {peso(item.price)}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: 16, borderWidth: 1, padding: Spacing.two, gap: Spacing.one },
  photo: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  prices: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  struck: { textDecorationLine: 'line-through' },
  compactText: { fontSize: 12, lineHeight: 16 },
});
```

- [ ] **Step 4: Create `src/components/popular-row.tsx`**

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { MenuItemCard } from '@/components/menu-item-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PopularItem } from '@/lib/types';

const ROW_SIZE = 4;

/** Home's "Popular now": the top items in one row, or nothing when there are none. */
export function PopularRow({ items, onSeeAll, onOpen }: { items: PopularItem[] | undefined; onSeeAll: () => void; onOpen: (item: PopularItem) => void }) {
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Popular now</ThemedText>
        <Pressable onPress={onSeeAll}>
          <ThemedText type="linkPrimary">See all</ThemedText>
        </Pressable>
      </View>
      <View style={styles.row}>
        {items.slice(0, ROW_SIZE).map((item) => (
          <MenuItemCard key={item.id} item={item} storeName={item.store_name} compact onPress={() => onOpen(item)} />
        ))}
        {/* Keep card widths even when there are fewer than 4. */}
        {Array.from({ length: Math.max(0, ROW_SIZE - items.length) }, (_, i) => (
          <View key={`spacer-${i}`} style={styles.spacer} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', gap: Spacing.two },
  spacer: { flex: 1 },
});
```

- [ ] **Step 5: Create `src/components/cart-button.tsx`**

```tsx
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCart } from '@/hooks/use-cart';
import { useTheme } from '@/hooks/use-theme';
import { peso } from '@/lib/format';

/** Floating "n items · ₱total" pill that opens the cart; hidden while the cart is empty. Place last in the screen. */
export function CartButton({ bottom = 0 }: { bottom?: number }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  if (cart.count === 0) return null;
  return (
    <Pressable
      onPress={() => router.push('/customer/cart')}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: pressed ? theme.primaryPressed : theme.primary, bottom: bottom + insets.bottom + Spacing.three },
      ]}>
      <Icon name={{ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }} size={20} color={theme.onPrimary} />
      <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
        {cart.count} {cart.count === 1 ? 'item' : 'items'} · {peso(cart.itemsTotal)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.2)',
  },
});
```

- [ ] **Step 6: Run, expect PASS** — `node_modules/.bin/jest && node_modules/.bin/tsc --noEmit && node_modules/.bin/expo lint`. Typed routes may reject `/customer/menu/[id]` and `/customer/cart` until Task 7 adds the screens; if so, finish Task 7's screen files first and run the checks together, recording the ruling.

- [ ] **Step 7: Commit**

```bash
git add src/components/menu-item-card.tsx src/components/popular-row.tsx src/components/cart-button.tsx src/components/__tests__/menu-item-card.test.tsx src/components/__tests__/popular-row.test.tsx
git commit -m "Add menu item card, popular row and cart button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Routes, Home row, Popular screen

**Files:**
- Modify: `src/app/customer/_layout.tsx`, `src/app/customer/(tabs)/index.tsx`
- Create: `src/app/customer/popular.tsx`

**Interfaces:**
- Consumes: `CartProvider`, `PopularRow`, `MenuItemCard`, `openMenuItem`, `CartButton`, `usePopularMenu`.

- [ ] **Step 1: `src/app/customer/_layout.tsx`** — wrap the `Stack` and add routes:

```tsx
import { CartProvider } from '@/hooks/use-cart';
```

```tsx
export default function CustomerLayout() {
  return (
    <CartProvider>
      <Stack screenOptions={{ headerTitle: () => <AppLogo size={32} />, headerTitleAlign: 'center' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Pickup screens: unreachable (even by link) while Pickup is switched off. */}
        <Stack.Protected guard={PICKUP_ENABLED}>
          <Stack.Screen name="pickup" options={{ title: 'Pickup', headerBackTitle: 'Back' }} />
          <Stack.Screen name="new-order" options={{ title: 'Menu', headerBackTitle: 'Back' }} />
          <Stack.Screen name="order/[id]" options={{ title: 'Order', headerBackTitle: 'Back' }} />
          <Stack.Screen name="popular" options={{ title: 'Popular now', headerBackTitle: 'Back' }} />
          <Stack.Screen name="menu/[id]" options={{ title: 'Item', headerBackTitle: 'Back' }} />
          <Stack.Screen name="cart" options={{ title: 'Cart', headerBackTitle: 'Back' }} />
        </Stack.Protected>
        <Stack.Screen name="stores" options={{ title: 'Choose a store', headerBackTitle: 'Back' }} />
        <Stack.Screen name="dropoff/location" options={{ title: 'Pickup location', headerBackTitle: 'Back' }} />
        <Stack.Screen name="dropoff/[id]" options={{ title: 'Drop off', headerBackTitle: 'Back' }} />
      </Stack>
    </CartProvider>
  );
}
```

- [ ] **Step 2: Create `src/app/customer/popular.tsx`**

```tsx
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { CartButton } from '@/components/cart-button';
import { ErrorText } from '@/components/error-text';
import { MenuItemCard, openMenuItem } from '@/components/menu-item-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePopularMenu } from '@/hooks/queries';
import type { PopularItem } from '@/lib/types';

const COLUMNS = 2;

export default function Popular() {
  const popular = usePopularMenu(50);
  const items = popular.data ?? [];
  const rows: PopularItem[][] = [];
  for (let i = 0; i < items.length; i += COLUMNS) rows.push(items.slice(i, i + COLUMNS));

  return (
    <View style={styles.fill}>
      <Screen edges={[]} onRefresh={popular.refetch}>
        {popular.isPending && <ActivityIndicator />}
        <ErrorText error={popular.error} />
        {popular.isSuccess && items.length === 0 && <ThemedText themeColor="textSecondary">Nothing on the menu yet.</ThemedText>}
        {rows.map((row) => (
          <View key={row[0].id} style={styles.row}>
            {row.map((item) => (
              <MenuItemCard key={item.id} item={item} storeName={item.store_name} onPress={() => openMenuItem(item)} />
            ))}
            {row.length < COLUMNS && <View style={styles.fill} />}
          </View>
        ))}
      </Screen>
      <CartButton />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.three },
});
```

- [ ] **Step 3: Home `src/app/customer/(tabs)/index.tsx`** — add imports:

```tsx
import { CartButton } from '@/components/cart-button';
import { openMenuItem } from '@/components/menu-item-card';
import { PopularRow } from '@/components/popular-row';
import { usePopularMenu } from '@/hooks/queries';
```

(merge `usePopularMenu` into the existing `@/hooks/queries` import). In the component add `const popular = usePopularMenu(4);`, change `onRefresh` to `() => Promise.all([history.refresh(), popular.refetch()])`, wrap the returned `Screen` in `<View style={styles.fill}>…<CartButton /></View>`, and insert between the tiles `View` and the recent-orders block:

```tsx
      {PICKUP_ENABLED && (
        <PopularRow items={popular.data} onSeeAll={() => router.push('/customer/popular')} onOpen={openMenuItem} />
      )}
```

Add `fill: { flex: 1 },` to the stylesheet.

- [ ] **Step 4: Verify** — `node_modules/.bin/tsc --noEmit && node_modules/.bin/expo lint && node_modules/.bin/jest`. (`menu/[id]` and `cart` route files arrive in Tasks 8–9; if typed routes reject `openMenuItem`/`CartButton` paths now, create those two files as `export default function X() { return null; }` placeholders in this task and fill them in Tasks 8–9 — ruling.)

- [ ] **Step 5: Commit**

```bash
git add src/app/customer/_layout.tsx "src/app/customer/(tabs)/index.tsx" src/app/customer/popular.tsx
git commit -m "Show popular menu on customer home with See all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Item page

**Files:**
- Create: `src/app/customer/menu/[id].tsx`

**Interfaces:**
- Consumes: `useStore(storeId)`, `useCart`, `confirmReplace`, `Screen footer`, `StatusBadge`, `Button`, `CartButton`.

- [ ] **Step 1: Create `src/app/customer/menu/[id].tsx`**

```tsx
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/hooks/queries';
import { confirmReplace, useCart } from '@/hooks/use-cart';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';

export default function MenuItemScreen() {
  const params = useLocalSearchParams<{ id: string; storeId: string }>();
  const itemId = Number(params.id);
  const store = useStore(Number(params.storeId));
  const cart = useCart();
  const theme = useTheme();
  const [qty, setQty] = useState(1);

  const item = store.data?.menu.find((m) => m.id === itemId);
  if (!item || !store.data) {
    return (
      <Screen edges={[]}>
        {store.isPending ? <ActivityIndicator /> : <ErrorText error={store.error ?? new Error('This item is no longer on the menu.')} />}
      </Screen>
    );
  }

  const shop = { id: store.data.id, name: store.data.name };
  const add = () => {
    if (cart.add(item, shop, qty) === 'needs-replace') {
      confirmReplace(cart.store!.name, () => {
        cart.replace(item, shop, qty);
        router.back();
      });
      return;
    }
    router.back();
  };

  return (
    <Screen edges={[]} footer={<Button title={`Add to cart · ${peso(discountedPrice(item) * qty)}`} onPress={add} />}>
      <Stack.Screen options={{ title: item.name }} />
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
          <Icon name={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} size={64} color={theme.primary} />
        </View>
      )}
      <View style={styles.info}>
        {item.best_seller && <StatusBadge label="Best seller" tone="info" />}
        <ThemedText type="subtitle">{item.name}</ThemedText>
        <Pressable onPress={() => router.push({ pathname: '/customer/new-order', params: { storeId: String(shop.id) } })}>
          <ThemedText type="linkPrimary">{shop.name}</ThemedText>
        </Pressable>
        {item.category ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.category}
          </ThemedText>
        ) : null}
        <View style={styles.prices}>
          <ThemedText type="smallBold" style={styles.price}>
            {peso(discountedPrice(item))}
          </ThemedText>
          {item.discount_percent > 0 && (
            <ThemedText themeColor="textSecondary" style={styles.struck}>
              {peso(item.price)}
            </ThemedText>
          )}
        </View>
      </View>
      <View style={styles.stepper}>
        <StepButton symbol="−" onPress={() => setQty((q) => Math.max(1, q - 1))} />
        <ThemedText type="subtitle" style={styles.count}>
          {qty}
        </ThemedText>
        <StepButton symbol="+" onPress={() => setQty((q) => Math.min(50, q + 1))} />
      </View>
    </Screen>
  );
}

function StepButton({ symbol, onPress }: { symbol: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.step, { backgroundColor: theme.primarySoft }]} accessibilityRole="button">
      <ThemedText type="subtitle" style={{ color: theme.primary }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  info: { gap: Spacing.one, alignItems: 'flex-start' },
  prices: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  price: { fontSize: 20, lineHeight: 28 },
  struck: { textDecorationLine: 'line-through' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  step: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 40, textAlign: 'center' },
});
```

- [ ] **Step 2: Verify** — `node_modules/.bin/tsc --noEmit && node_modules/.bin/expo lint && node_modules/.bin/jest`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/customer/menu/[id].tsx"
git commit -m "Add menu item page with add to cart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cart screen; store menu writes to the cart

**Files:**
- Create: `src/app/customer/cart.tsx`
- Modify: `src/app/customer/new-order.tsx`

**Interfaces:**
- Consumes: `useCart`, `confirmReplace`, `useCreateOrder` (`NewOrder` shape), `TextField`, `Screen footer`.

- [ ] **Step 1: Create `src/app/customer/cart.tsx`**

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder } from '@/hooks/queries';
import { useCart } from '@/hooks/use-cart';
import { discountedPrice, peso } from '@/lib/format';

export default function CartScreen() {
  const cart = useCart();
  const createOrder = useCreateOrder();
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  if (!cart.store) {
    return (
      <Screen edges={[]}>
        <ThemedText themeColor="textSecondary">Your cart is empty.</ThemedText>
        <Button title="Browse popular" variant="secondary" onPress={() => router.replace('/customer/popular')} />
      </Screen>
    );
  }

  const store = cart.store;
  const submit = () =>
    createOrder.mutate(
      {
        type: 'pickup',
        store_id: store.id,
        items: cart.lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })),
        customer_address: address,
        notes,
      },
      {
        onSuccess: (order) => {
          cart.clear();
          router.replace({ pathname: '/customer/order/[id]', params: { id: String(order.id) } });
        },
      },
    );

  return (
    <Screen
      edges={[]}
      footer={
        <>
          <View style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
              Items + delivery fee
            </ThemedText>
            <ThemedText type="smallBold">{peso(cart.itemsTotal)}</ThemedText>
          </View>
          <ErrorText error={createOrder.error} />
          <Button title="Place order" onPress={submit} loading={createOrder.isPending} />
        </>
      }>
      <Card>
        <ThemedText type="smallBold">{store.name}</ThemedText>
        {cart.lines.map(({ item, qty }) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.grow}>
              <ThemedText type="small">{item.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {peso(discountedPrice(item) * qty)}
              </ThemedText>
            </View>
            <Stepper value={qty} onChange={(delta) => cart.setQty(item.id, qty + delta)} />
          </View>
        ))}
        <Pressable onPress={() => router.push({ pathname: '/customer/new-order', params: { storeId: String(store.id) } })}>
          <ThemedText type="linkPrimary">Add more from {store.name}</ThemedText>
        </Pressable>
      </Card>
      <TextField label="Delivery address" value={address} onChangeText={setAddress} multiline />
      <TextField label="Notes" placeholder="e.g. less ice, no onions" value={notes} onChangeText={setNotes} multiline />
      <ThemedText type="small" themeColor="textSecondary">
        Pay cash to the driver.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
```

- [ ] **Step 2: Rewrite `src/app/customer/new-order.tsx`** (store menu; laundry stores keep the old address/notes flow since laundry pickups have no items)

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useStore } from '@/hooks/queries';
import { confirmReplace, useCart } from '@/hooks/use-cart';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

export default function NewOrder() {
  const storeId = Number(useLocalSearchParams<{ storeId: string }>().storeId);
  const store = useStore(storeId);
  const cart = useCart();
  const createOrder = useCreateOrder();
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  if (store.isPending) {
    return (
      <Screen edges={[]}>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (store.isError) {
    return (
      <Screen edges={[]}>
        <ErrorText error={store.error} />
      </Screen>
    );
  }

  const { name, address: storeAddress, type, menu } = store.data;
  const shop = { id: storeId, name };
  const inThisCart = cart.store?.id === storeId;

  const change = (item: MenuItem, delta: number) => {
    if (inThisCart && cart.qtyOf(item.id) > 0) return cart.setQty(item.id, cart.qtyOf(item.id) + delta);
    if (delta <= 0) return;
    if (cart.add(item, shop, delta) === 'needs-replace') confirmReplace(cart.store!.name, () => cart.replace(item, shop, delta));
  };

  // Laundry pickups have no items: order straight from here.
  if (type === 'laundry') {
    const submit = () =>
      createOrder.mutate(
        { type: 'pickup', store_id: storeId, items: [], customer_address: address, notes },
        { onSuccess: (order) => router.replace({ pathname: '/customer/order/[id]', params: { id: String(order.id) } }) },
      );
    return (
      <Screen
        edges={[]}
        footer={
          <>
            <ErrorText error={createOrder.error} />
            <Button title="Place order" onPress={submit} loading={createOrder.isPending} />
          </>
        }>
        <Card>
          <ThemedText type="smallBold">{name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {storeAddress}
          </ThemedText>
        </Card>
        <TextField label="Delivery address" value={address} onChangeText={setAddress} multiline />
        <TextField label="Notes" placeholder="e.g. claim ticket #, number of bags" value={notes} onChangeText={setNotes} multiline />
        <ThemedText type="small" themeColor="textSecondary">
          Pay cash to the driver.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen
      edges={[]}
      footer={
        <Button
          title={cart.count > 0 ? `View cart · ${peso(cart.itemsTotal)}` : 'View cart'}
          onPress={() => router.push('/customer/cart')}
          disabled={cart.count === 0}
        />
      }>
      <Card>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {storeAddress}
        </ThemedText>
      </Card>
      {menu.map((item) => (
        <Card key={item.id} onPress={() => router.push({ pathname: '/customer/menu/[id]', params: { id: String(item.id), storeId: String(storeId) } })}>
          <View style={styles.row}>
            <View style={[styles.grow, styles.itemText]}>
              <View style={styles.nameRow}>
                <ThemedText type="small">{item.name}</ThemedText>
                {item.best_seller ? <StatusBadge label="Best seller" tone="info" /> : null}
              </View>
              <View style={styles.nameRow}>
                <ThemedText type="smallBold">{peso(discountedPrice(item))}</ThemedText>
                {item.discount_percent > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.struck}>
                    {peso(item.price)}
                  </ThemedText>
                )}
              </View>
            </View>
            <Stepper value={inThisCart ? cart.qtyOf(item.id) : 0} onChange={(delta) => change(item, delta)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  itemText: { gap: Spacing.half },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  struck: { textDecorationLine: 'line-through' },
});
```

- [ ] **Step 3: Create `src/components/stepper.tsx`** (shared by Cart and the store menu)

```tsx
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** − count + in soft blue pills; `onChange` gets the step (−1 or +1). */
export function Stepper({ value, onChange }: { value: number; onChange: (delta: number) => void }) {
  const theme = useTheme();
  const step = (symbol: string, delta: number) => (
    <Pressable onPress={() => onChange(delta)} style={[styles.step, { backgroundColor: theme.primarySoft }]} accessibilityRole="button">
      <ThemedText type="smallBold" style={{ color: theme.primary }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {step('−', -1)}
      <ThemedText type="smallBold" style={styles.count}>
        {value}
      </ThemedText>
      {step('+', 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 24, textAlign: 'center' },
});
```

- [ ] **Step 4: Verify** — `node_modules/.bin/tsc --noEmit && node_modules/.bin/expo lint && node_modules/.bin/jest`.

- [ ] **Step 5: Commit**

```bash
git add src/app/customer/cart.tsx src/app/customer/new-order.tsx src/components/stepper.tsx
git commit -m "Add cart checkout and move store menu onto the cart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification

- [ ] **Step 1:** `cd worker && node_modules/.bin/vitest run && node_modules/.bin/vitest run -c vitest.v2.config.ts && node_modules/.bin/tsc --noEmit` → all pass.
- [ ] **Step 2:** repo root: `node_modules/.bin/expo lint && node_modules/.bin/tsc --noEmit && node_modules/.bin/jest` → all pass (apk-server tsc errors only).
- [ ] **Step 3:** Hex sweep on new files: `grep -n "#[0-9A-Fa-f]\{6\}" src/components/menu-item-card.tsx src/components/popular-row.tsx src/components/cart-button.tsx src/components/stepper.tsx src/app/customer/popular.tsx "src/app/customer/menu/[id].tsx" src/app/customer/cart.tsx` → none.
- [ ] **Step 4:** Manual (Android, light + dark; local worker `cd worker && node_modules/.bin/wrangler d1 migrations apply dryyt --local` then `node_modules/.bin/wrangler dev`): Home shows Popular now (4 cards) → See all grid → item → Add to cart → cart pill → Cart → Place order → order detail; other-store add prompts; store menu steppers reflect the cart. If no device is available, record it as not done.
- [ ] **Step 5:** Report results, rulings, and that `wrangler d1 migrations apply dryyt --remote` + deploy are **not** run (production, needs the user's go-ahead).
