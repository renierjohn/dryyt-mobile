# Popular Menu + Cart — Design

Date: 2026-10-17
Branch: `feature-UI-revamp` (builds on the UI revamp: tokens, `Card`, `Screen footer`, `BottomBar`, `StatusBadge`)

## Goal

Show the most popular food menu items on the customer Home tab (top 4 in one row + "See all"), let customers open an item, add it to a cart, and check out through the existing Pickup order flow.

## Decisions

- Pickup is switched **on** (app + worker together) so checkout uses `POST /orders`.
- `popularity` is **computed by the worker**: total qty delivered. Nobody edits it.
- Cart holds **one store at a time**; adding from another store asks to replace it.
- Cart lives in memory (lost on app close).

## 1. Worker (`worker/`)

### Migration `0013_menu_popularity.sql`

```sql
ALTER TABLE store_menu_items ADD COLUMN popularity INTEGER NOT NULL DEFAULT 0;
CREATE INDEX store_menu_items_popularity ON store_menu_items (popularity DESC);
-- Order lines snapshot name/price; this links them back to the menu item for counting.
ALTER TABLE order_items ADD COLUMN menu_item_id INTEGER REFERENCES store_menu_items(id);
-- Best effort for old lines: same store, same name.
UPDATE order_items SET menu_item_id = (
  SELECT m.id FROM store_menu_items m JOIN orders o ON o.id = order_items.order_id
  WHERE m.store_id = o.store_id AND m.name = order_items.name LIMIT 1
);
UPDATE store_menu_items SET popularity = COALESCE((
  SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
  WHERE oi.menu_item_id = store_menu_items.id AND o.status = 'delivered'
), 0);
```

### Writes

- `POST /orders` (`routes/orders.ts`): insert `menu_item_id` with each order line.
- `POST /jobs/:id/status` → `delivered` (`routes/jobs.ts`): add to the existing batch, before `move`, guarded by the old status so it only lands with the status change:
  `UPDATE store_menu_items SET popularity = popularity + (SELECT SUM(qty) FROM order_items WHERE order_id = ?1 AND menu_item_id = store_menu_items.id) WHERE id IN (SELECT menu_item_id FROM order_items WHERE order_id = ?1) AND (SELECT status FROM orders WHERE id = ?1) = ?2`
- Cancelled orders never count.

### Read: `GET /menu/popular?limit=N`

- New route file `routes/menu.ts`, mounted at `/menu`, `requireAuth`, behind the same `PICKUP_ENABLED` gate as `/orders` (403 when off).
- `limit` 1–50, default 4; 400 otherwise.
- Food stores only. `ORDER BY popularity DESC, best_seller DESC, id DESC`.
- Response: `{ items: PopularItem[] }` where `PopularItem = MenuItem & { store_id, store_name, store_logo }`.

### Types

- Worker and app `MenuItem` gain `popularity: number` (read-only; owner edit/create schemas ignore it). `MENU_SELECT` includes it.

### Config

- `worker/wrangler.jsonc` `PICKUP_ENABLED: "true"`; `src/constants/features.ts` `PICKUP_ENABLED = true`.

## 2. App

### Cart — `src/hooks/use-cart.tsx`

- `CartProvider` mounted in `src/app/customer/_layout.tsx`.
- State: `{ store: { id, name } | null, lines: { item: MenuItem, qty: number }[] }`.
- API: `add(item, store, qty)` → returns `'added' | 'needs-replace'`; `replace(item, store, qty)` clears then adds; `setQty(itemId, qty)` (0 removes; clamp 0–50); `clear()`; derived `count` (sum of qty) and `itemsTotal` (sum of `discountedPrice(item) * qty`).
- Callers show the replace prompt with `Alert.alert('Start a new cart?', 'Your cart from {Store} will be cleared.', [Cancel, Start new cart])`.

### Components

- `MenuItemCard` (`src/components/menu-item-card.tsx`): photo (`expo-image`, 1:1, radius 12) or primarySoft placeholder with fork-knife icon; name (2 lines max), store name, discounted price + struck original. `compact` prop for the home row. `flex: 1`.
- `CartButton` (`src/components/cart-button.tsx`): floating pill (primary bg) "{count} item(s) · ₱{total}" → `/customer/cart`. Renders nothing when cart is empty.

### Screens

- **Home** `(tabs)/index.tsx`: "Popular now" section between tiles and Recent orders, only when `PICKUP_ENABLED`; header row with "See all" → `/customer/popular`; one row of up to 4 `MenuItemCard compact`. Hidden while loading, on error, or when empty. `CartButton` overlay.
- **Popular** `customer/popular.tsx` (title "Popular now"): 2-column grid, `limit=50`, `CartButton`.
- **Item** `customer/menu/[id].tsx` (title = item name): params `id` + `storeId`; data from `useStore(storeId)` (menu + store) — no new item endpoint. Large photo, `StatusBadge` "Best seller" (info), name, store name, category, price; quantity stepper (min 1). Footer: "Add to cart · ₱{price×qty}". On add → `router.back()`. `CartButton` overlay.
- **Cart** `customer/cart.tsx` (title "Cart"): store name header card; each line with stepper (0 removes); address + notes `TextField`s; "Pay cash to the driver."; footer: "Items ₱x + delivery fee" and "Place order" (`useCreateOrder` with `{ type: 'pickup', store_id, items, customer_address, notes }`) → `cart.clear()` then `router.replace('/customer/order/{id}')`. Empty state: "Your cart is empty." + "Browse popular" button.
- **Store menu** `new-order.tsx`: steppers read/write the cart (with replace prompt); address/notes/place-order move to Cart; footer becomes "View cart · ₱{total}" (disabled when empty).
- Routes added to `customer/_layout.tsx` inside the `PICKUP_ENABLED` guard: `popular`, `menu/[id]`, `cart`.

### Queries — `src/hooks/queries.ts`

- `usePopularMenu(limit: number)` → `GET /menu/popular?limit=`, `enabled: PICKUP_ENABLED`, key `['popular', limit]`.

## Out of scope

Cart persistence across restarts, multi-store carts, promos, owner-visible popularity UI, recommendations.

## Testing

- **Worker (vitest):** migration backfill sets popularity from delivered lines only; delivering an order increments its items' popularity once (second delivered call 409s, no double count); cancelled orders don't count; `POST /orders` stores `menu_item_id`; `/menu/popular` sorts by popularity then best_seller, honours `limit`, excludes laundry, 400 on bad limit, 403 when Pickup off.
- **App (jest):** `useCart` add / needs-replace / replace / setQty 0 removes / totals; `MenuItemCard` renders price + struck original; Home hides "Popular now" when the query returns no items.
- Manual: Home → item → add → cart → place order on Android (light + dark).
