# Dryyt Delivery App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers book food/laundry Pickups and laundry Drop offs; drivers accept and complete them; backed by a Cloudflare Worker.

**Architecture:** `worker/` is a standalone Hono app on Cloudflare Workers with D1 (schema + seed as migrations), JWT auth, and role-guarded REST routes. The Expo Router app (`src/app`) talks to it through a tiny `fetch` wrapper and TanStack Query (5 s polling for live status). Routing is split by role with `Stack.Protected`.

**Tech Stack:** Cloudflare Workers, Hono, D1, zod, Vitest + `@cloudflare/vitest-pool-workers`; Expo SDK 57, Expo Router (NativeTabs), TanStack Query v5, expo-secure-store.

**Spec:** `docs/superpowers/specs/2026-10-09-delivery-app-design.md`

## Global Constraints

- Backend lives only in `worker/` with its own `package.json`; the root `tsconfig.json` and ESLint must exclude it.
- Package manager: yarn (both root and `worker/`).
- Money is integer centavos everywhere; display as `₱` with 2 decimals. Delivery fee = `5000` (₱50) via `DELIVERY_FEE` var.
- Roles: `customer` | `driver`. Store types: `food` | `laundry`. Order types: `pickup` | `dropoff`.
- Statuses: `pending` → `accepted` → `picked_up` → `delivered`; `cancelled` only from `pending` by the owning customer.
- Every API error body is `{ "error": string }`; codes 400/401/403/404/409 per spec.
- A driver holds at most one `accepted`/`picked_up` job.
- No maps, payments, push, chat, ratings. Targets iOS + Android (web not required).
- App reads API base URL from `EXPO_PUBLIC_API_URL`.

## Review Focus

1. **Two drivers tap Accept on the same job** → exactly one wins, the other gets 409. Pinned in Task 5 (`concurrent accepts`).
2. **Driver with an active job accepts another** → 409, enforced by a partial unique index, not only app logic. Pinned in Task 5.
3. **Client tampers with prices or sends another store's menu item** → server ignores client prices and returns 400 for foreign items. Pinned in Task 4.
4. **Customer opens/cancels someone else's order by guessing the id** → 403. Pinned in Task 4.
5. **Non-numeric or unknown ids (`/orders/abc`)** → 404, not a 500. Pinned in Tasks 3 and 4.

---

## File Structure

```
worker/
  package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, .gitignore, .dev.vars.example
  migrations/0001_init.sql        schema
  migrations/0002_seed.sql        stores + menus
  src/index.ts                    app wiring, CORS, error handler, /health, /me
  src/types.ts                    Bindings, AppEnv, domain types
  src/lib/http.ts                 fail(), parseBody(), parseId()
  src/lib/password.ts             PBKDF2 hash/verify
  src/lib/auth.ts                 signToken, requireAuth, requireRole
  src/lib/orders.ts               ORDER_SELECT, listOrders, getOrder
  src/routes/auth.ts              /auth/register, /auth/login
  src/routes/stores.ts            /stores
  src/routes/orders.ts            /orders (customer)
  src/routes/jobs.ts              /jobs (driver)
  test/env.d.ts, test/apply-migrations.ts, test/helpers.ts
  test/health.test.ts, auth.test.ts, stores.test.ts, orders.test.ts, jobs.test.ts

src/
  lib/types.ts                    API types (mirror of worker)
  lib/format.ts                   peso(), STATUS_LABEL, orderTitle(), route()
  lib/api.ts                      fetch wrapper, ApiError, token + 401 handler
  lib/session-storage.ts          SecureStore session persistence
  lib/query-client.ts             QueryClient singleton
  hooks/use-auth.tsx              AuthProvider + useAuth
  hooks/queries.ts                all useQuery/useMutation hooks
  components/screen.tsx, button.tsx, text-field.tsx, card.tsx, error-text.tsx,
  components/order-summary.tsx, status-timeline.tsx, profile-screen.tsx
  app/_layout.tsx                 providers + protected Stack
  app/index.tsx                   role redirect
  app/sign-in.tsx, app/sign-up.tsx
  app/customer/_layout.tsx        Stack
  app/customer/(tabs)/_layout.tsx NativeTabs: index, orders, profile
  app/customer/(tabs)/index.tsx, orders.tsx, profile.tsx
  app/customer/pickup.tsx, stores.tsx, new-order.tsx, order/[id].tsx
  app/driver/_layout.tsx          NativeTabs: index, active, history, profile
  app/driver/index.tsx, active.tsx, history.tsx, profile.tsx
```

Deleted template files: `src/app/explore.tsx`, `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`, `src/components/hint-row.tsx`, `src/components/web-badge.tsx`, `src/components/external-link.tsx`, `src/components/ui/collapsible.tsx`. `src/app/index.tsx` is rewritten. `animated-icon.*` is kept (splash overlay).

---

### Task 1: Worker scaffold, schema, seed

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.jsonc`, `worker/vitest.config.ts`, `worker/.gitignore`, `worker/.dev.vars.example`
- Create: `worker/migrations/0001_init.sql`, `worker/migrations/0002_seed.sql`
- Create: `worker/src/index.ts`, `worker/src/types.ts`, `worker/src/lib/http.ts`
- Create: `worker/test/env.d.ts`, `worker/test/apply-migrations.ts`, `worker/test/helpers.ts`, `worker/test/health.test.ts`
- Modify: `tsconfig.json` (exclude `worker`)

**Interfaces:**
- Produces: `AppEnv`, `Bindings`, `Role`, `StoreType`, `OrderType`, `OrderStatus`, `User`, `Store`, `MenuItem`, `OrderItem`, `OrderRow`, `OrderDetail` from `src/types.ts`; `fail(status, message): never`, `parseBody(c, schema)`, `parseId(c, name?)` from `src/lib/http.ts`; default-exported Hono `app` from `src/index.ts`; test helpers `api(path, opts)` → `{status, body}` and `registerUser(role)` → `{token, user}`.

- [ ] **Step 1: Commit the existing template as a baseline**

```bash
git add -A && git commit -m "chore: initial Expo template"
```

- [ ] **Step 2: Create `worker/package.json` and install deps**

```json
{
  "name": "dryyt-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --ip 0.0.0.0",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:migrate:local": "wrangler d1 migrations apply dryyt --local",
    "db:migrate:remote": "wrangler d1 migrations apply dryyt --remote"
  }
}
```

Run:
```bash
cd worker && yarn add hono zod && yarn add -D wrangler typescript @cloudflare/workers-types vitest@~3.2.0 @cloudflare/vitest-pool-workers@^0.8.0
```

- [ ] **Step 3: Config files**

`worker/wrangler.jsonc`:
```jsonc
{
  "name": "dryyt-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "vars": { "DELIVERY_FEE": "5000" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "dryyt",
      // Local dev/tests accept any id. Before deploying, run `wrangler d1 create dryyt` and paste the real id.
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
}
```

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`worker/vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: { bindings: { TEST_MIGRATIONS: migrations, JWT_SECRET: 'test-secret' } },
        },
      },
    },
  };
});
```

`worker/.gitignore`:
```
node_modules/
.wrangler/
.dev.vars
```

`worker/.dev.vars.example`:
```
JWT_SECRET=change-me-to-a-long-random-string
```

Root `tsconfig.json` — add after `"include"`:
```json
  "exclude": ["node_modules", "worker"]
```

- [ ] **Step 4: Migrations**

`worker/migrations/0001_init.sql`:
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'driver')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('food', 'laundry')),
  address TEXT NOT NULL
);

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('pickup', 'dropoff')),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  driver_id INTEGER REFERENCES users(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'picked_up', 'delivered', 'cancelled')),
  customer_address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  items_total INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);

CREATE INDEX orders_customer ON orders (customer_id);
CREATE INDEX orders_status ON orders (status);
CREATE INDEX order_items_order ON order_items (order_id);
-- A driver can hold only one active job.
CREATE UNIQUE INDEX orders_one_active_job ON orders (driver_id) WHERE status IN ('accepted', 'picked_up');
```

`worker/migrations/0002_seed.sql`:
```sql
INSERT INTO stores (id, name, type, address) VALUES
  (1, 'Tea Haven', 'food', '12 Mabini St, Makati'),
  (2, 'Burger Barn', 'food', '45 Rizal Ave, Makati'),
  (3, 'Silog Express', 'food', '8 Bonifacio St, Makati'),
  (4, 'Fresh Fold Laundry', 'laundry', '20 Luna St, Makati'),
  (5, 'Bubble Wash Laundromat', 'laundry', '77 Del Pilar St, Makati');

INSERT INTO menu_items (id, store_id, name, price) VALUES
  (1, 1, 'Wintermelon Milk Tea', 12000),
  (2, 1, 'Okinawa Milk Tea', 13000),
  (3, 1, 'Taro Milk Tea', 12500),
  (4, 1, 'Brown Sugar Boba', 14000),
  (5, 2, 'Classic Burger', 15000),
  (6, 2, 'Cheeseburger', 17000),
  (7, 2, 'Fries', 8000),
  (8, 2, 'Iced Tea', 5000),
  (9, 3, 'Tapsilog', 16000),
  (10, 3, 'Longsilog', 14000),
  (11, 3, 'Tocilog', 14000),
  (12, 3, 'Extra Rice', 2500);
```

- [ ] **Step 5: Shared types and HTTP helpers**

`worker/src/types.ts`:
```ts
export type Role = 'customer' | 'driver';
export type StoreType = 'food' | 'laundry';
export type OrderType = 'pickup' | 'dropoff';
export type OrderStatus = 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export type Bindings = { DB: D1Database; JWT_SECRET: string; DELIVERY_FEE: string };
export type AuthUser = { id: number; role: Role };
export type AppEnv = { Bindings: Bindings; Variables: { user: AuthUser } };

export type User = { id: number; email: string; name: string; phone: string; role: Role };
export type Store = { id: number; name: string; type: StoreType; address: string };
export type MenuItem = { id: number; name: string; price: number };
export type OrderItem = { id: number; name: string; price: number; qty: number };

export type OrderRow = {
  id: number;
  type: OrderType;
  customer_id: number;
  driver_id: number | null;
  store_id: number;
  status: OrderStatus;
  customer_address: string;
  notes: string;
  items_total: number;
  delivery_fee: number;
  created_at: string;
  updated_at: string;
  store_name: string;
  store_address: string;
  store_type: StoreType;
  customer_name: string;
  customer_phone: string;
  driver_name: string | null;
  driver_phone: string | null;
};
export type OrderDetail = OrderRow & { items: OrderItem[] };
```

`worker/src/lib/http.ts`:
```ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message });
}

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    fail(400, issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
  }
  return result.data;
}

export function parseId(c: Context, name = 'id'): number {
  const id = Number(c.req.param(name));
  if (!Number.isInteger(id) || id <= 0) fail(404, 'Not found');
  return id;
}
```

- [ ] **Step 6: App entry with health check**

`worker/src/index.ts`:
```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

export default app;
```

- [ ] **Step 7: Test harness**

`worker/test/env.d.ts`:
```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    JWT_SECRET: string;
    DELIVERY_FEE: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

`worker/test/apply-migrations.ts`:
```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`worker/test/helpers.ts`:
```ts
import { SELF } from 'cloudflare:test';

type Options = { method?: 'GET' | 'POST'; body?: unknown; token?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, opts: Options = {}) {
  const res = await SELF.fetch(`https://api.test${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

let counter = 0;

export async function registerUser(role: 'customer' | 'driver') {
  counter += 1;
  const { body } = await api<{ token: string; user: { id: number } }>('/auth/register', {
    body: {
      email: `${role}${counter}@test.com`,
      password: 'password123',
      name: `${role} ${counter}`,
      phone: `0917000${String(counter).padStart(4, '0')}`,
      role,
    },
  });
  return body;
}
```

`worker/test/health.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { api } from './helpers';

describe('health', () => {
  it('responds ok', async () => {
    const res = await api('/health');
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await api('/nope');
    expect(res).toEqual({ status: 404, body: { error: 'Not found' } });
  });

  it('has seeded stores and menu items', async () => {
    const stores = await env.DB.prepare('SELECT COUNT(*) AS n FROM stores').first<{ n: number }>();
    const items = await env.DB.prepare('SELECT COUNT(*) AS n FROM menu_items').first<{ n: number }>();
    expect(stores?.n).toBe(5);
    expect(items?.n).toBe(12);
  });
});
```

- [ ] **Step 8: Run tests and typecheck**

Run: `cd worker && yarn test && yarn typecheck`
Expected: 3 tests PASS, no type errors. (`registerUser` is unused until Task 2 — that is fine.)

- [ ] **Step 9: Commit**

```bash
git add worker tsconfig.json
git commit -m "feat(worker): scaffold Hono worker with D1 schema and seed"
```

---

### Task 2: Auth (register, login, /me, guards)

**Files:**
- Create: `worker/src/lib/password.ts`, `worker/src/lib/auth.ts`, `worker/src/routes/auth.ts`, `worker/test/auth.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `fail`, `parseBody`, `AppEnv`, `User`, `Role`, `AuthUser` (Task 1)
- Produces: `hashPassword(pw): Promise<string>`, `verifyPassword(pw, stored): Promise<boolean>`, `signToken(user: AuthUser, secret): Promise<string>`, `requireAuth` middleware (sets `c.get('user')`), `requireRole(role)` middleware. Endpoints: `POST /auth/register` → 201 `{token, user}`, `POST /auth/login` → `{token, user}`, `GET /me` → `{user}`.

- [ ] **Step 1: Write failing tests** — `worker/test/auth.test.ts`

```ts
import { describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

const ana = { email: ' Ana@Test.com ', password: 'password123', name: 'Ana', phone: '09171234567', role: 'customer' };

describe('auth', () => {
  it('registers a user, normalizing email', async () => {
    const res = await api('/auth/register', { body: ana });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      email: 'ana@test.com',
      name: 'Ana',
      phone: '09171234567',
      role: 'customer',
    });
  });

  it('rejects a duplicate email', async () => {
    await api('/auth/register', { body: ana });
    const res = await api('/auth/register', { body: { ...ana, email: 'ana@test.com' } });
    expect(res).toEqual({ status: 409, body: { error: 'Email is already registered' } });
  });

  it('rejects a short password and an unknown role', async () => {
    expect((await api('/auth/register', { body: { ...ana, password: 'short' } })).status).toBe(400);
    expect((await api('/auth/register', { body: { ...ana, role: 'admin' } })).status).toBe(400);
    expect((await api('/auth/register', { body: undefined, method: 'POST' })).status).toBe(400);
  });

  it('logs in with the right password only', async () => {
    await api('/auth/register', { body: ana });
    const ok = await api('/auth/login', { body: { email: 'ANA@test.com', password: 'password123' } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('ana@test.com');
    expect(ok.body.user.password_hash).toBeUndefined();

    const bad = await api('/auth/login', { body: { email: 'ana@test.com', password: 'wrong-password' } });
    expect(bad).toEqual({ status: 401, body: { error: 'Invalid email or password' } });

    const unknown = await api('/auth/login', { body: { email: 'nobody@test.com', password: 'password123' } });
    expect(unknown.status).toBe(401);
  });

  it('returns the current user from /me', async () => {
    const { token, user } = await registerUser('driver');
    const res = await api('/me', { token });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: 'driver' });
  });

  it('rejects missing or invalid tokens', async () => {
    expect(await api('/me')).toEqual({ status: 401, body: { error: 'Not signed in' } });
    const res = await api('/me', { token: 'garbage' });
    expect(res).toEqual({ status: 401, body: { error: 'Session expired, please sign in again' } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && yarn test test/auth.test.ts`
Expected: FAIL (404 responses — routes don't exist).

- [ ] **Step 3: Implement password hashing** — `worker/src/lib/password.ts`

```ts
const ITERATIONS = 100_000; // Workers' PBKDF2 maximum
const encoder = new TextEncoder();

const toHex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
}

/** Returns `saltHex:hashHex`. */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${toHex(salt)}:${toHex(await derive(password, salt))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const actual = new Uint8Array(await derive(password, fromHex(saltHex)));
  const expected = fromHex(hashHex);
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Implement token + guards** — `worker/src/lib/auth.ts`

```ts
import { createMiddleware } from 'hono/factory';
import { sign, verify } from 'hono/jwt';

import type { AppEnv, AuthUser, Role } from '../types';
import { fail } from './http';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export function signToken(user: AuthUser, secret: string) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ sub: user.id, role: user.role, exp }, secret, 'HS256');
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) fail(401, 'Not signed in');

  let user: AuthUser;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    user = { id: Number(payload.sub), role: payload.role as Role };
  } catch {
    fail(401, 'Session expired, please sign in again');
  }
  c.set('user', user);
  await next();
});

export const requireRole = (role: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get('user').role !== role) fail(403, `Only ${role}s can do this`);
    await next();
  });
```

- [ ] **Step 5: Implement routes** — `worker/src/routes/auth.ts`

```ts
import { Hono } from 'hono';
import { z } from 'zod';

import { signToken } from '../lib/auth';
import { fail, parseBody } from '../lib/http';
import { hashPassword, verifyPassword } from '../lib/password';
import type { AppEnv, User } from '../types';

const email = z.string().trim().toLowerCase().email('Enter a valid email');

const registerSchema = z.object({
  email,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().min(7, 'Phone is required'),
  role: z.enum(['customer', 'driver']),
});

const loginSchema = z.object({ email, password: z.string().min(1) });

const auth = new Hono<AppEnv>();

auth.post('/register', async (c) => {
  const input = await parseBody(c, registerSchema);
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(input.email).first();
  if (existing) fail(409, 'Email is already registered');

  const user = await db
    .prepare(
      'INSERT INTO users (email, password_hash, name, phone, role) VALUES (?, ?, ?, ?, ?) RETURNING id, email, name, phone, role',
    )
    .bind(input.email, await hashPassword(input.password), input.name, input.phone, input.role)
    .first<User>();
  if (!user) fail(500, 'Could not create user');

  return c.json({ token: await signToken(user, c.env.JWT_SECRET), user }, 201);
});

auth.post('/login', async (c) => {
  const input = await parseBody(c, loginSchema);
  const row = await c.env.DB.prepare('SELECT id, email, name, phone, role, password_hash FROM users WHERE email = ?')
    .bind(input.email)
    .first<User & { password_hash: string }>();
  if (!row || !(await verifyPassword(input.password, row.password_hash))) fail(401, 'Invalid email or password');

  const { password_hash: _, ...user } = row;
  return c.json({ token: await signToken(user, c.env.JWT_SECRET), user });
});

export default auth;
```

- [ ] **Step 6: Wire into app** — in `worker/src/index.ts`, add imports and routes after the `/health` line:

```ts
import { requireAuth } from './lib/auth';
import { fail } from './lib/http';
import auth from './routes/auth';
import type { AppEnv, User } from './types';
```
(replace the existing `import type { AppEnv } from './types';`)

```ts
app.route('/auth', auth);

app.get('/me', requireAuth, async (c) => {
  const user = await c.env.DB.prepare('SELECT id, email, name, phone, role FROM users WHERE id = ?')
    .bind(c.get('user').id)
    .first<User>();
  if (!user) fail(401, 'Session expired, please sign in again');
  return c.json({ user });
});
```

- [ ] **Step 7: Run tests**

Run: `cd worker && yarn test && yarn typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add worker
git commit -m "feat(worker): email/password auth with JWT and role guards"
```

---

### Task 3: Stores

**Files:**
- Create: `worker/src/routes/stores.ts`, `worker/test/stores.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `requireAuth`, `fail`, `parseId`, `Store`, `MenuItem`
- Produces: `GET /stores?type=` → `{stores: Store[]}`; `GET /stores/:id` → `{store: Store & {menu: MenuItem[]}}`

- [ ] **Step 1: Write failing tests** — `worker/test/stores.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let token: string;

beforeEach(async () => {
  token = (await registerUser('customer')).token;
});

describe('stores', () => {
  it('requires auth', async () => {
    expect((await api('/stores')).status).toBe(401);
  });

  it('lists all stores or filters by type', async () => {
    expect((await api('/stores', { token })).body.stores).toHaveLength(5);

    const food = await api('/stores?type=food', { token });
    expect(food.body.stores).toHaveLength(3);
    expect(food.body.stores.every((s: { type: string }) => s.type === 'food')).toBe(true);

    expect((await api('/stores?type=laundry', { token })).body.stores).toHaveLength(2);
  });

  it('rejects an unknown type', async () => {
    expect((await api('/stores?type=pharmacy', { token })).status).toBe(400);
  });

  it('returns a food store with its menu', async () => {
    const res = await api('/stores/1', { token });
    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ id: 1, name: 'Tea Haven', type: 'food' });
    expect(res.body.store.menu).toHaveLength(4);
    expect(res.body.store.menu[0]).toEqual({ id: 1, name: 'Wintermelon Milk Tea', price: 12000 });
  });

  it('returns a laundry store with an empty menu', async () => {
    const res = await api('/stores/4', { token });
    expect(res.body.store).toMatchObject({ type: 'laundry', menu: [] });
  });

  it('404s for unknown or non-numeric ids', async () => {
    expect((await api('/stores/999', { token })).status).toBe(404);
    expect((await api('/stores/abc', { token })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && yarn test test/stores.test.ts`
Expected: FAIL (404s on `/stores`).

- [ ] **Step 3: Implement** — `worker/src/routes/stores.ts`

```ts
import { Hono } from 'hono';

import { requireAuth } from '../lib/auth';
import { fail, parseId } from '../lib/http';
import type { AppEnv, MenuItem, Store } from '../types';

const stores = new Hono<AppEnv>();
stores.use('*', requireAuth);

stores.get('/', async (c) => {
  const type = c.req.query('type');
  if (type !== undefined && type !== 'food' && type !== 'laundry') fail(400, 'type must be food or laundry');

  const query = type
    ? c.env.DB.prepare('SELECT * FROM stores WHERE type = ? ORDER BY name').bind(type)
    : c.env.DB.prepare('SELECT * FROM stores ORDER BY name');
  const { results } = await query.all<Store>();
  return c.json({ stores: results });
});

stores.get('/:id', async (c) => {
  const id = parseId(c);
  const store = await c.env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(id).first<Store>();
  if (!store) fail(404, 'Store not found');

  const { results: menu } = await c.env.DB.prepare('SELECT id, name, price FROM menu_items WHERE store_id = ? ORDER BY id')
    .bind(id)
    .all<MenuItem>();
  return c.json({ store: { ...store, menu } });
});

export default stores;
```

In `worker/src/index.ts`: add `import stores from './routes/stores';` and `app.route('/stores', stores);` after `app.route('/auth', auth);`.

- [ ] **Step 4: Run tests**

Run: `cd worker && yarn test && yarn typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat(worker): store listing and menus"
```

---

### Task 4: Customer orders

**Files:**
- Create: `worker/src/lib/orders.ts`, `worker/src/routes/orders.ts`, `worker/test/orders.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `requireAuth`, `requireRole`, `fail`, `parseBody`, `parseId`, `OrderRow`, `OrderDetail`, `OrderItem`, `OrderStatus`, `MenuItem`, `StoreType`
- Produces: `listOrders(db, clause, ...binds): Promise<OrderRow[]>`, `getOrder(db, id): Promise<OrderDetail | null>`. Endpoints: `POST /orders` → 201 `{order: OrderDetail}`; `GET /orders` → `{orders: OrderRow[]}`; `GET /orders/:id` → `{order}`; `POST /orders/:id/cancel` → `{order}`.

- [ ] **Step 1: Write failing tests** — `worker/test/orders.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let customer: string;
let other: string;

beforeEach(async () => {
  customer = (await registerUser('customer')).token;
  other = (await registerUser('customer')).token;
});

const foodOrder = {
  type: 'pickup',
  store_id: 1,
  items: [
    { menu_item_id: 1, qty: 2, price: 1 }, // client price must be ignored
    { menu_item_id: 3, qty: 1 },
  ],
  customer_address: '1 Customer St, Makati',
  notes: 'less ice',
};

describe('POST /orders', () => {
  it('creates a food pickup with server-computed prices', async () => {
    const res = await api('/orders', { token: customer, body: foodOrder });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      type: 'pickup',
      status: 'pending',
      store_id: 1,
      store_name: 'Tea Haven',
      store_type: 'food',
      items_total: 2 * 12000 + 12500,
      delivery_fee: 5000,
      driver_id: null,
      notes: 'less ice',
    });
    expect(res.body.order.items).toEqual([
      { id: expect.any(Number), name: 'Wintermelon Milk Tea', price: 12000, qty: 2 },
      { id: expect.any(Number), name: 'Taro Milk Tea', price: 12500, qty: 1 },
    ]);
  });

  it('requires at least one item for food', async () => {
    const res = await api('/orders', { token: customer, body: { ...foodOrder, items: [] } });
    expect(res).toEqual({ status: 400, body: { error: 'Add at least one item' } });
  });

  it("rejects an item from another store's menu", async () => {
    const res = await api('/orders', { token: customer, body: { ...foodOrder, items: [{ menu_item_id: 5, qty: 1 }] } });
    expect(res.status).toBe(400);
  });

  it('rejects zero or huge quantities', async () => {
    expect((await api('/orders', { token: customer, body: { ...foodOrder, items: [{ menu_item_id: 1, qty: 0 }] } })).status).toBe(400);
    expect((await api('/orders', { token: customer, body: { ...foodOrder, items: [{ menu_item_id: 1, qty: 51 }] } })).status).toBe(400);
  });

  it('creates a laundry pickup with no items', async () => {
    const res = await api('/orders', {
      token: customer,
      body: { type: 'pickup', store_id: 4, customer_address: '1 Customer St', notes: 'ticket #42' },
    });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ store_type: 'laundry', items_total: 0, delivery_fee: 5000, items: [] });
  });

  it('creates a laundry drop off', async () => {
    const res = await api('/orders', { token: customer, body: { type: 'dropoff', store_id: 5, customer_address: '1 Customer St' } });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ type: 'dropoff', store_name: 'Bubble Wash Laundromat', notes: '' });
  });

  it('rejects drop off to a food store', async () => {
    const res = await api('/orders', { token: customer, body: { type: 'dropoff', store_id: 1, customer_address: '1 Customer St' } });
    expect(res).toEqual({ status: 400, body: { error: 'Drop off is only available for laundry shops' } });
  });

  it('rejects menu items on laundry orders', async () => {
    const res = await api('/orders', {
      token: customer,
      body: { type: 'pickup', store_id: 4, items: [{ menu_item_id: 1, qty: 1 }], customer_address: '1 Customer St' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing address and unknown store', async () => {
    expect((await api('/orders', { token: customer, body: { ...foodOrder, customer_address: '' } })).status).toBe(400);
    expect((await api('/orders', { token: customer, body: { ...foodOrder, store_id: 999 } })).status).toBe(404);
  });

  it('forbids drivers from ordering', async () => {
    const driver = (await registerUser('driver')).token;
    expect((await api('/orders', { token: driver, body: foodOrder })).status).toBe(403);
  });
});

describe('reading and cancelling orders', () => {
  it("lists only the customer's own orders, newest first", async () => {
    const first = await api('/orders', { token: customer, body: foodOrder });
    const second = await api('/orders', { token: customer, body: { type: 'dropoff', store_id: 4, customer_address: '1 Customer St' } });
    await api('/orders', { token: other, body: foodOrder });

    const res = await api('/orders', { token: customer });
    expect(res.body.orders.map((o: { id: number }) => o.id)).toEqual([second.body.order.id, first.body.order.id]);
  });

  it("forbids reading another customer's order", async () => {
    const { body } = await api('/orders', { token: customer, body: foodOrder });
    expect((await api(`/orders/${body.order.id}`, { token: customer })).status).toBe(200);
    expect((await api(`/orders/${body.order.id}`, { token: other })).status).toBe(403);
  });

  it('lets a driver read a pending order', async () => {
    const { body } = await api('/orders', { token: customer, body: foodOrder });
    const driver = (await registerUser('driver')).token;
    expect((await api(`/orders/${body.order.id}`, { token: driver })).status).toBe(200);
  });

  it('404s for unknown or non-numeric ids', async () => {
    expect((await api('/orders/999', { token: customer })).status).toBe(404);
    expect((await api('/orders/abc', { token: customer })).status).toBe(404);
  });

  it('cancels a pending order once, only by its owner', async () => {
    const { body } = await api('/orders', { token: customer, body: foodOrder });
    const id = body.order.id;

    expect((await api(`/orders/${id}/cancel`, { token: other, method: 'POST' })).status).toBe(403);

    const res = await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');

    const again = await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect(again).toEqual({ status: 409, body: { error: 'Order can no longer be cancelled' } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && yarn test test/orders.test.ts`
Expected: FAIL (404s on `/orders`).

- [ ] **Step 3: Implement order queries** — `worker/src/lib/orders.ts`

```ts
import type { OrderDetail, OrderItem, OrderRow } from '../types';

const ORDER_SELECT = `
  SELECT o.*,
    s.name AS store_name, s.address AS store_address, s.type AS store_type,
    cu.name AS customer_name, cu.phone AS customer_phone,
    d.name AS driver_name, d.phone AS driver_phone
  FROM orders o
  JOIN stores s ON s.id = o.store_id
  JOIN users cu ON cu.id = o.customer_id
  LEFT JOIN users d ON d.id = o.driver_id`;

/** `clause` is trusted SQL written in this codebase (WHERE ... ORDER BY ...); values go in `binds`. */
export async function listOrders(db: D1Database, clause: string, ...binds: unknown[]) {
  const { results } = await db.prepare(`${ORDER_SELECT} WHERE ${clause}`).bind(...binds).all<OrderRow>();
  return results;
}

export async function getOrder(db: D1Database, id: number): Promise<OrderDetail | null> {
  const order = await db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first<OrderRow>();
  if (!order) return null;
  const { results: items } = await db
    .prepare('SELECT id, name, price, qty FROM order_items WHERE order_id = ? ORDER BY id')
    .bind(id)
    .all<OrderItem>();
  return { ...order, items };
}
```

- [ ] **Step 4: Implement routes** — `worker/src/routes/orders.ts`

```ts
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { fail, parseBody, parseId } from '../lib/http';
import { getOrder, listOrders } from '../lib/orders';
import type { AppEnv, MenuItem, StoreType } from '../types';

const createSchema = z.object({
  type: z.enum(['pickup', 'dropoff']),
  store_id: z.number().int().positive(),
  items: z
    .array(z.object({ menu_item_id: z.number().int().positive(), qty: z.number().int().min(1).max(50) }))
    .max(50)
    .default([]),
  customer_address: z.string().trim().min(5, 'Address is required'),
  notes: z.string().trim().max(500).default(''),
});

type Line = { name: string; price: number; qty: number };

async function priceItems(db: D1Database, storeId: number, items: { menu_item_id: number; qty: number }[]): Promise<Line[]> {
  const ids = [...new Set(items.map((i) => i.menu_item_id))];
  const { results } = await db
    .prepare(`SELECT id, name, price FROM menu_items WHERE store_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(storeId, ...ids)
    .all<MenuItem>();
  const menu = new Map(results.map((m) => [m.id, m]));

  return items.map((i) => {
    const item = menu.get(i.menu_item_id);
    if (!item) fail(400, `Item ${i.menu_item_id} is not on this store's menu`);
    return { name: item.name, price: item.price, qty: i.qty };
  });
}

const orders = new Hono<AppEnv>();
orders.use('*', requireAuth);

orders.post('/', requireRole('customer'), async (c) => {
  const input = await parseBody(c, createSchema);
  const db = c.env.DB;
  const customerId = c.get('user').id;

  const store = await db.prepare('SELECT id, type FROM stores WHERE id = ?').bind(input.store_id).first<{ id: number; type: StoreType }>();
  if (!store) fail(404, 'Store not found');
  if (input.type === 'dropoff' && store.type !== 'laundry') fail(400, 'Drop off is only available for laundry shops');

  let lines: Line[] = [];
  if (store.type === 'food') {
    if (input.items.length === 0) fail(400, 'Add at least one item');
    lines = await priceItems(db, store.id, input.items);
  } else if (input.items.length > 0) {
    fail(400, 'Laundry orders do not take menu items');
  }

  const itemsTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  // D1 batches run in one transaction, so MAX(id) for this customer is the order just inserted.
  const [created] = await db.batch([
    db
      .prepare('INSERT INTO orders (type, customer_id, store_id, customer_address, notes, items_total, delivery_fee) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(input.type, customerId, store.id, input.customer_address, input.notes, itemsTotal, Number(c.env.DELIVERY_FEE)),
    ...lines.map((l) =>
      db
        .prepare('INSERT INTO order_items (order_id, name, price, qty) VALUES ((SELECT MAX(id) FROM orders WHERE customer_id = ?), ?, ?, ?)')
        .bind(customerId, l.name, l.price, l.qty),
    ),
  ]);

  return c.json({ order: await getOrder(db, created.meta.last_row_id) }, 201);
});

orders.get('/', requireRole('customer'), async (c) => {
  return c.json({ orders: await listOrders(c.env.DB, 'o.customer_id = ? ORDER BY o.id DESC', c.get('user').id) });
});

orders.get('/:id', async (c) => {
  const order = await getOrder(c.env.DB, parseId(c));
  if (!order) fail(404, 'Order not found');

  const user = c.get('user');
  const allowed =
    user.role === 'customer' ? order.customer_id === user.id : order.driver_id === user.id || order.status === 'pending';
  if (!allowed) fail(403, 'You cannot view this order');

  return c.json({ order });
});

orders.post('/:id/cancel', requireRole('customer'), async (c) => {
  const id = parseId(c);
  const db = c.env.DB;

  const order = await db.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(id).first<{ customer_id: number }>();
  if (!order) fail(404, 'Order not found');
  if (order.customer_id !== c.get('user').id) fail(403, 'You cannot cancel this order');

  const { meta } = await db
    .prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(id)
    .run();
  if (meta.changes === 0) fail(409, 'Order can no longer be cancelled');

  return c.json({ order: await getOrder(db, id) });
});

export default orders;
```

In `worker/src/index.ts`: add `import orders from './routes/orders';` and `app.route('/orders', orders);`.

- [ ] **Step 5: Run tests**

Run: `cd worker && yarn test && yarn typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "feat(worker): customer order creation, listing, cancel"
```

---

### Task 5: Driver jobs

**Files:**
- Create: `worker/src/routes/jobs.ts`, `worker/test/jobs.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `listOrders`, `getOrder`, `requireAuth`, `requireRole`, `fail`, `parseBody`, `parseId`, `OrderStatus`
- Produces: `GET /jobs/available` → `{jobs: OrderRow[]}`; `GET /jobs/active` → `{job: OrderDetail | null}`; `GET /jobs/history` → `{jobs: OrderRow[]}`; `POST /jobs/:id/accept` → `{job}`; `POST /jobs/:id/status` body `{status: 'picked_up'|'delivered'}` → `{job}`.

- [ ] **Step 1: Write failing tests** — `worker/test/jobs.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { api, registerUser } from './helpers';

let customer: string;
let driver: string;
let driver2: string;

beforeEach(async () => {
  customer = (await registerUser('customer')).token;
  driver = (await registerUser('driver')).token;
  driver2 = (await registerUser('driver')).token;
});

async function placeOrder(): Promise<number> {
  const res = await api('/orders', {
    token: customer,
    body: { type: 'pickup', store_id: 2, items: [{ menu_item_id: 5, qty: 1 }], customer_address: '1 Customer St, Makati' },
  });
  return res.body.order.id;
}

const accept = (id: number, token: string) => api(`/jobs/${id}/accept`, { token, method: 'POST' });
const advance = (id: number, token: string, status: string) => api(`/jobs/${id}/status`, { token, body: { status } });

describe('jobs', () => {
  it('lists pending orders for drivers only', async () => {
    const id = await placeOrder();
    const res = await api('/jobs/available', { token: driver });
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j: { id: number }) => j.id)).toEqual([id]);
    expect((await api('/jobs/available', { token: customer })).status).toBe(403);
  });

  it('accepts a job and shows the driver to the customer', async () => {
    const id = await placeOrder();
    const res = await accept(id, driver);
    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({ id, status: 'accepted', driver_name: expect.any(String) });

    const seen = await api(`/orders/${id}`, { token: customer });
    expect(seen.body.order.driver_phone).toEqual(expect.any(String));
    expect((await api('/jobs/available', { token: driver2 })).body.jobs).toEqual([]);
  });

  it('lets only one of two concurrent accepts win', async () => {
    const id = await placeOrder();
    const results = await Promise.all([accept(id, driver), accept(id, driver2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('blocks a driver from holding two active jobs', async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    await accept(first, driver);
    expect(await accept(second, driver)).toEqual({ status: 409, body: { error: 'Finish your active job first' } });
  });

  it('rejects accepting cancelled or unknown jobs', async () => {
    const id = await placeOrder();
    await api(`/orders/${id}/cancel`, { token: customer, method: 'POST' });
    expect((await accept(id, driver)).status).toBe(409);
    expect((await accept(999, driver)).status).toBe(404);
  });

  it('moves through statuses in order, by the assigned driver only', async () => {
    const id = await placeOrder();
    await accept(id, driver);

    expect((await advance(id, driver, 'delivered')).status).toBe(409);
    expect((await advance(id, driver2, 'picked_up')).status).toBe(403);
    expect((await advance(id, driver, 'cancelled')).status).toBe(400);

    expect((await advance(id, driver, 'picked_up')).body.job.status).toBe('picked_up');
    expect((await advance(id, driver, 'delivered')).body.job.status).toBe('delivered');
    expect((await advance(id, driver, 'delivered')).status).toBe(409);
  });

  it('tracks the active job and history', async () => {
    const id = await placeOrder();
    expect((await api('/jobs/active', { token: driver })).body.job).toBeNull();

    await accept(id, driver);
    const active = await api('/jobs/active', { token: driver });
    expect(active.body.job).toMatchObject({ id, items: [{ name: 'Classic Burger', qty: 1 }] });

    await advance(id, driver, 'picked_up');
    await advance(id, driver, 'delivered');
    expect((await api('/jobs/active', { token: driver })).body.job).toBeNull();
    expect((await api('/jobs/history', { token: driver })).body.jobs.map((j: { id: number }) => j.id)).toEqual([id]);

    // Free again after delivering.
    expect((await accept(await placeOrder(), driver)).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd worker && yarn test test/jobs.test.ts`
Expected: FAIL (404s on `/jobs`).

- [ ] **Step 3: Implement** — `worker/src/routes/jobs.ts`

```ts
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, requireRole } from '../lib/auth';
import { fail, parseBody, parseId } from '../lib/http';
import { getOrder, listOrders } from '../lib/orders';
import type { AppEnv, OrderStatus } from '../types';

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = { accepted: 'picked_up', picked_up: 'delivered' };

const statusSchema = z.object({ status: z.enum(['picked_up', 'delivered']) });

const jobs = new Hono<AppEnv>();
jobs.use('*', requireAuth, requireRole('driver'));

jobs.get('/available', async (c) => {
  return c.json({ jobs: await listOrders(c.env.DB, "o.status = 'pending' ORDER BY o.id") });
});

jobs.get('/active', async (c) => {
  const row = await c.env.DB.prepare("SELECT id FROM orders WHERE driver_id = ? AND status IN ('accepted', 'picked_up')")
    .bind(c.get('user').id)
    .first<{ id: number }>();
  return c.json({ job: row ? await getOrder(c.env.DB, row.id) : null });
});

jobs.get('/history', async (c) => {
  const history = await listOrders(c.env.DB, "o.driver_id = ? AND o.status = 'delivered' ORDER BY o.updated_at DESC, o.id DESC", c.get('user').id);
  return c.json({ jobs: history });
});

jobs.post('/:id/accept', async (c) => {
  const id = parseId(c);
  const db = c.env.DB;

  let changes: number;
  try {
    const { meta } = await db
      .prepare("UPDATE orders SET driver_id = ?, status = 'accepted', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
      .bind(c.get('user').id, id)
      .run();
    changes = meta.changes;
  } catch (err) {
    // orders_one_active_job unique index
    if (String(err).includes('UNIQUE')) fail(409, 'Finish your active job first');
    throw err;
  }

  if (changes === 0) {
    const exists = await db.prepare('SELECT id FROM orders WHERE id = ?').bind(id).first();
    if (!exists) fail(404, 'Job not found');
    fail(409, 'Job is no longer available');
  }

  return c.json({ job: await getOrder(db, id) });
});

jobs.post('/:id/status', async (c) => {
  const id = parseId(c);
  const { status } = await parseBody(c, statusSchema);
  const db = c.env.DB;

  const order = await db.prepare('SELECT driver_id, status FROM orders WHERE id = ?').bind(id).first<{ driver_id: number | null; status: OrderStatus }>();
  if (!order) fail(404, 'Job not found');
  if (order.driver_id !== c.get('user').id) fail(403, 'This is not your job');
  if (NEXT_STATUS[order.status] !== status) fail(409, `Cannot change status from ${order.status} to ${status}`);

  const { meta } = await db
    .prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?")
    .bind(status, id, order.status)
    .run();
  if (meta.changes === 0) fail(409, 'Job changed, refresh and try again');

  return c.json({ job: await getOrder(db, id) });
});

export default jobs;
```

In `worker/src/index.ts`: add `import jobs from './routes/jobs';` and `app.route('/jobs', jobs);`.

- [ ] **Step 4: Run tests**

Run: `cd worker && yarn test && yarn typecheck`
Expected: all PASS.

- [ ] **Step 5: Smoke-test local dev server**

```bash
cd worker && cp .dev.vars.example .dev.vars && yarn db:migrate:local && (yarn dev &) && sleep 5 && curl -s localhost:8787/health; kill %1 2>/dev/null; pkill -f "wrangler dev" || true
```
Expected: `{"ok":true}`.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "feat(worker): driver job board, atomic accept, status transitions"
```

---

### Task 6: App foundation (deps, lint, API client, auth state, queries)

**Files:**
- Create: `eslint.config.js`, `.env.example`, `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/api.ts`, `src/lib/session-storage.ts`, `src/lib/query-client.ts`, `src/hooks/use-auth.tsx`, `src/hooks/queries.ts`
- Modify: `package.json` (deps via expo install), `src/constants/theme.ts` (add `Brand`)

**Interfaces:**
- Consumes: API contract from Tasks 2–5.
- Produces: `api<T>(path, {method?, body?})`, `ApiError {status}`, `setAuthToken`, `setUnauthorizedHandler`; `Session = {token, user}`, `loadSession/saveSession/clearSession`; `queryClient`; `AuthProvider`, `useAuth() → {state, signIn(session), signOut()}` with `state` = `{status:'loading'} | {status:'signedOut'} | {status:'signedIn', user}`; hooks `useStores(type)`, `useStore(id)`, `useMyOrders()`, `useOrder(id)`, `useCreateOrder()`, `useCancelOrder(id)`, `useAvailableJobs()`, `useActiveJob()`, `useJobHistory()`, `useAcceptJob()`, `useAdvanceJob()`; `peso(c)`, `STATUS_LABEL`, `orderTitle(o)`, `route(o) → {from, to}`; `Brand.primary`, `Brand.danger`.

- [ ] **Step 1: Install deps and lint config**

```bash
npx expo install @tanstack/react-query expo-secure-store
npx expo install eslint eslint-config-expo -- --dev
```

`eslint.config.js`:
```js
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([expoConfig, { ignores: ['dist/*', 'worker/*'] }]);
```

`.env.example`:
```
# iOS simulator: http://localhost:8787
# Android emulator: http://10.0.2.2:8787
# Physical device: http://<your-computer-LAN-IP>:8787
EXPO_PUBLIC_API_URL=http://localhost:8787
```

Run: `cp .env.example .env` — then add `.env` to `.gitignore` under `# local env files`.

- [ ] **Step 2: Brand colors** — append to `src/constants/theme.ts`:

```ts
export const Brand = {
  primary: '#208AEF',
  danger: '#E5484D',
} as const;
```

- [ ] **Step 3: Types and formatting**

`src/lib/types.ts`:
```ts
// Mirrors worker/src/types.ts
export type Role = 'customer' | 'driver';
export type StoreType = 'food' | 'laundry';
export type OrderType = 'pickup' | 'dropoff';
export type OrderStatus = 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export type User = { id: number; email: string; name: string; phone: string; role: Role };
export type Store = { id: number; name: string; type: StoreType; address: string };
export type MenuItem = { id: number; name: string; price: number };
export type StoreWithMenu = Store & { menu: MenuItem[] };
export type OrderItem = { id: number; name: string; price: number; qty: number };

export type Order = {
  id: number;
  type: OrderType;
  customer_id: number;
  driver_id: number | null;
  store_id: number;
  status: OrderStatus;
  customer_address: string;
  notes: string;
  items_total: number;
  delivery_fee: number;
  created_at: string;
  updated_at: string;
  store_name: string;
  store_address: string;
  store_type: StoreType;
  customer_name: string;
  customer_phone: string;
  driver_name: string | null;
  driver_phone: string | null;
};
export type OrderDetail = Order & { items: OrderItem[] };
```

`src/lib/format.ts`:
```ts
import type { Order, OrderStatus } from './types';

export const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Waiting for a driver',
  accepted: 'Driver accepted',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function orderTitle(order: Pick<Order, 'type' | 'store_type'>) {
  if (order.type === 'dropoff') return 'Laundry drop off';
  return order.store_type === 'food' ? 'Food pickup' : 'Laundry pickup';
}

/** Where the driver collects (`from`) and where they finish (`to`). */
export function route(order: Order) {
  return order.type === 'pickup'
    ? { from: order.store_address, to: order.customer_address }
    : { from: order.customer_address, to: order.store_address };
}
```

- [ ] **Step 4: API client, session, query client**

`src/lib/api.ts`:
```ts
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

let authToken: string | null = null;
let onUnauthorized = () => {};

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = { method?: 'GET' | 'POST'; body?: unknown };

export async function api<T>(path: string, { method, body }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}
```

`src/lib/session-storage.ts`:
```ts
import * as SecureStore from 'expo-secure-store';

import type { User } from './types';

const KEY = 'session';

export type Session = { token: string; user: User };

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export const saveSession = (session: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(session));

export const clearSession = () => SecureStore.deleteItemAsync(KEY);
```

`src/lib/query-client.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Client errors won't fix themselves; only retry network/server failures.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});
```

- [ ] **Step 5: Auth provider** — `src/hooks/use-auth.tsx`

```tsx
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

import { setAuthToken, setUnauthorizedHandler } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { clearSession, loadSession, saveSession, type Session } from '@/lib/session-storage';
import type { User } from '@/lib/types';

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User };

type AuthContextValue = {
  state: AuthState;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const signIn = useCallback(async (session: Session) => {
    setAuthToken(session.token);
    await saveSession(session);
    setState({ status: 'signedIn', user: session.user });
  }, []);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    await clearSession();
    queryClient.clear();
    setState({ status: 'signedOut' });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    loadSession().then((session) => {
      if (!session) return setState({ status: 'signedOut' });
      setAuthToken(session.token);
      setState({ status: 'signedIn', user: session.user });
    });
  }, [signOut]);

  return <AuthContext value={{ state, signIn, signOut }}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 6: Query hooks** — `src/hooks/queries.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Order, OrderDetail, OrderType, Store, StoreType, StoreWithMenu } from '@/lib/types';

const POLL_MS = 5000;

export type NewOrder = {
  type: OrderType;
  store_id: number;
  items: { menu_item_id: number; qty: number }[];
  customer_address: string;
  notes: string;
};

export const useStores = (type: StoreType) =>
  useQuery({
    queryKey: ['stores', type],
    queryFn: () => api<{ stores: Store[] }>(`/stores?type=${type}`).then((r) => r.stores),
  });

export const useStore = (id: number) =>
  useQuery({
    queryKey: ['store', id],
    queryFn: () => api<{ store: StoreWithMenu }>(`/stores/${id}`).then((r) => r.store),
  });

export const useMyOrders = () =>
  useQuery({
    queryKey: ['orders'],
    queryFn: () => api<{ orders: Order[] }>('/orders').then((r) => r.orders),
    refetchInterval: POLL_MS,
  });

export const useOrder = (id: number) =>
  useQuery({
    queryKey: ['order', id],
    queryFn: () => api<{ order: OrderDetail }>(`/orders/${id}`).then((r) => r.order),
    refetchInterval: POLL_MS,
  });

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewOrder) => api<{ order: OrderDetail }>('/orders', { body: input }).then((r) => r.order),
    onSuccess: (order) => {
      qc.setQueryData(['order', order.id], order);
      return qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useCancelOrder(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ order: OrderDetail }>(`/orders/${id}/cancel`, { method: 'POST' }).then((r) => r.order),
    onSuccess: (order) => {
      qc.setQueryData(['order', id], order);
      return qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export const useAvailableJobs = () =>
  useQuery({
    queryKey: ['jobs', 'available'],
    queryFn: () => api<{ jobs: Order[] }>('/jobs/available').then((r) => r.jobs),
    refetchInterval: POLL_MS,
  });

export const useActiveJob = () =>
  useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api<{ job: OrderDetail | null }>('/jobs/active').then((r) => r.job),
    refetchInterval: POLL_MS,
  });

export const useJobHistory = () =>
  useQuery({
    queryKey: ['jobs', 'history'],
    queryFn: () => api<{ jobs: Order[] }>('/jobs/history').then((r) => r.jobs),
  });

export function useAcceptJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ job: OrderDetail }>(`/jobs/${id}/accept`, { method: 'POST' }).then((r) => r.job),
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useAdvanceJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'picked_up' | 'delivered' }) =>
      api<{ job: OrderDetail }>(`/jobs/${id}/status`, { body: { status } }).then((r) => r.job),
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}
```

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && yarn lint`
Expected: no errors (template screens still present and compiling).

- [ ] **Step 8: Commit**

```bash
git add -A -- . ':!worker'
git commit -m "feat(app): API client, auth state, query hooks"
```

---

### Task 7: Shared UI, auth screens, role routing

**Files:**
- Create: `src/components/screen.tsx`, `button.tsx`, `text-field.tsx`, `card.tsx`, `error-text.tsx`, `order-summary.tsx`, `status-timeline.tsx`, `profile-screen.tsx`
- Create: `src/app/sign-in.tsx`, `src/app/sign-up.tsx`
- Rewrite: `src/app/_layout.tsx`, `src/app/index.tsx`
- Delete: `src/app/explore.tsx`, `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`, `src/components/hint-row.tsx`, `src/components/web-badge.tsx`, `src/components/external-link.tsx`, `src/components/ui/collapsible.tsx`

**Interfaces:**
- Consumes: Task 6 exports; `ThemedText`, `useTheme`, `Spacing`, `BottomTabInset`, `MaxContentWidth`, `Brand`.
- Produces: `<Screen edges? onRefresh?>`, `<Button title onPress variant? disabled? loading?>`, `<TextField label ...TextInputProps>`, `<Card onPress?>`, `<ErrorText error>`, `<OrderSummary order>`, `<StatusTimeline status>`, `<ProfileScreen />`. Routes: `/sign-in`, `/sign-up`, `/` (redirect), protected `customer` and `driver` segments (built in Tasks 8–9).

- [ ] **Step 1: Delete template files**

```bash
git rm src/app/explore.tsx src/components/app-tabs.tsx src/components/app-tabs.web.tsx src/components/hint-row.tsx src/components/web-badge.tsx src/components/external-link.tsx src/components/ui/collapsible.tsx
```

- [ ] **Step 2: Shared components**

`src/components/screen.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  children: ReactNode;
  /** Use `[]` on screens that show a navigation header. */
  edges?: Edge[];
  onRefresh?: () => Promise<unknown>;
};

export function Screen({ children, edges = ['top'], onRefresh }: Props) {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await onRefresh?.();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={edges}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
```

`src/components/button.tsx`:
```tsx
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false }: Props) {
  const theme = useTheme();
  const background = variant === 'primary' ? Brand.primary : variant === 'danger' ? Brand.danger : theme.backgroundSelected;
  const color = variant === 'secondary' ? theme.text : '#ffffff';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      {loading ? <ActivityIndicator color={color} /> : <ThemedText type="smallBold" style={{ color }}>{title}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

`src/components/text-field.tsx`:
```tsx
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TextField({ label, style, ...rest }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 16 },
});
```

`src/components/card.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Card({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const theme = useTheme();
  const content = <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
});
```

`src/components/error-text.tsx`:
```tsx
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';

export function ErrorText({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <ThemedText type="small" style={{ color: Brand.danger }}>
      {error.message}
    </ThemedText>
  );
}
```

`src/components/status-timeline.tsx`:
```tsx
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { STATUS_LABEL } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';

const STEPS: OrderStatus[] = ['pending', 'accepted', 'picked_up', 'delivered'];

export function StatusTimeline({ status }: { status: OrderStatus }) {
  const theme = useTheme();

  if (status === 'cancelled') {
    return (
      <ThemedText type="smallBold" style={{ color: Brand.danger }}>
        {STATUS_LABEL.cancelled}
      </ThemedText>
    );
  }

  const current = STEPS.indexOf(status);
  return (
    <View style={styles.list}>
      {STEPS.map((step, i) => (
        <View key={step} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: i <= current ? Brand.primary : theme.backgroundSelected }]} />
          <ThemedText type={i === current ? 'smallBold' : 'small'} themeColor={i <= current ? 'text' : 'textSecondary'}>
            {STATUS_LABEL[step]}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
```

`src/components/order-summary.tsx`:
```tsx
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { orderTitle, peso, route, STATUS_LABEL } from '@/lib/format';
import type { Order, OrderDetail } from '@/lib/types';

export function OrderSummary({ order }: { order: Order | OrderDetail }) {
  const { from, to } = route(order);
  return (
    <View style={styles.summary}>
      <View style={styles.header}>
        <ThemedText type="smallBold" style={styles.title}>
          {orderTitle(order)} · {order.store_name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          #{order.id}
        </ThemedText>
      </View>
      <ThemedText type="small">{STATUS_LABEL[order.status]}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        From: {from}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        To: {to}
      </ThemedText>
      {'items' in order &&
        order.items.map((item) => (
          <ThemedText key={item.id} type="small">
            {item.qty} × {item.name} — {peso(item.price * item.qty)}
          </ThemedText>
        ))}
      {order.notes ? <ThemedText type="small">Notes: {order.notes}</ThemedText> : null}
      <ThemedText type="smallBold">Total (cash): {peso(order.items_total + order.delivery_fee)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.one },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1 },
});
```

`src/components/profile-screen.tsx`:
```tsx
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';

export function ProfileScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== 'signedIn') return null;
  const { user } = state;

  return (
    <Screen>
      <ThemedText type="subtitle">{user.name}</ThemedText>
      <ThemedText>{user.email}</ThemedText>
      <ThemedText>{user.phone}</ThemedText>
      <ThemedText themeColor="textSecondary">{user.role === 'driver' ? 'Driver' : 'Customer'}</ThemedText>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
```

- [ ] **Step 3: Auth screens**

`src/app/sign-in.tsx`:
```tsx
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Session } from '@/lib/session-storage';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<Session>('/auth/login', { body: { email, password } }),
    onSuccess: signIn,
  });

  return (
    <Screen>
      <ThemedText type="subtitle">Dryyt</ThemedText>
      <ThemedText themeColor="textSecondary">Sign in to continue</ThemedText>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <ErrorText error={login.error} />
      <Button title="Sign in" onPress={() => login.mutate()} loading={login.isPending} />
      <Link href="/sign-up">
        <ThemedText type="linkPrimary">No account? Create one</ThemedText>
      </Link>
    </Screen>
  );
}
```

`src/app/sign-up.tsx`:
```tsx
import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Session } from '@/lib/session-storage';
import type { Role } from '@/lib/types';

export default function SignUp() {
  const { signIn } = useAuth();
  const [role, setRole] = useState<Role>('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const register = useMutation({
    mutationFn: () => api<Session>('/auth/register', { body: { role, name, phone, email, password } }),
    onSuccess: signIn,
  });

  return (
    <Screen>
      <ThemedText type="subtitle">Create account</ThemedText>
      <View style={styles.roles}>
        {(['customer', 'driver'] as const).map((r) => (
          <View key={r} style={styles.role}>
            <Button
              title={r === 'customer' ? "I'm a customer" : "I'm a driver"}
              variant={role === r ? 'primary' : 'secondary'}
              onPress={() => setRole(r)}
            />
          </View>
        ))}
      </View>
      <TextField label="Name" value={name} onChangeText={setName} autoComplete="name" />
      <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <ErrorText error={register.error} />
      <Button title="Create account" onPress={() => register.mutate()} loading={register.isPending} />
      <Link href="/sign-in">
        <ThemedText type="linkPrimary">Already have an account? Sign in</ThemedText>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  roles: { flexDirection: 'row', gap: Spacing.two },
  role: { flex: 1 },
});
```

- [ ] **Step 4: Root layout and index redirect**

`src/app/_layout.tsx`:
```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { queryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AnimatedSplashOverlay />
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const { state } = useAuth();
  if (state.status === 'loading') return null;
  const role = state.status === 'signedIn' ? state.user.role : null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={role === null}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'customer'}>
        <Stack.Screen name="customer" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'driver'}>
        <Stack.Screen name="driver" />
      </Stack.Protected>
    </Stack>
  );
}
```

`src/app/index.tsx`:
```tsx
import { Redirect } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';

export default function Index() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') return <Redirect href="/sign-in" />;
  return <Redirect href={state.user.role === 'driver' ? '/driver' : '/customer'} />;
}
```

- [ ] **Step 5: Placeholder role layouts so routes resolve** (replaced in Tasks 8 and 9)

`src/app/customer/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

export default function CustomerLayout() {
  return <Stack />;
}
```
`src/app/customer/index.tsx` and `src/app/driver/index.tsx` both:
```tsx
import { ProfileScreen } from '@/components/profile-screen';

export default ProfileScreen;
```
`src/app/driver/_layout.tsx`: same as customer layout with name `DriverLayout`.

- [ ] **Step 6: Typecheck, lint, run**

Run: `npx tsc --noEmit && yarn lint`
Expected: no errors.

Manual: start worker (`cd worker && yarn dev`) and app (`yarn ios` or `yarn android`). Register a customer → lands on the profile placeholder showing name; Sign out → back to sign-in; sign in again works; wrong password shows "Invalid email or password".

- [ ] **Step 7: Commit**

```bash
git add -A -- . ':!worker'
git commit -m "feat(app): shared UI, auth screens, role-based routing"
```

---

### Task 8: Customer screens

**Files:**
- Rewrite: `src/app/customer/_layout.tsx`
- Delete: `src/app/customer/index.tsx` (placeholder)
- Create: `src/app/customer/(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/orders.tsx`, `(tabs)/profile.tsx`, `src/app/customer/pickup.tsx`, `stores.tsx`, `new-order.tsx`, `order/[id].tsx`

**Interfaces:**
- Consumes: `useStores`, `useStore`, `useCreateOrder`, `useMyOrders`, `useOrder`, `useCancelOrder`, all Task 7 components, `peso`.
- Produces: routes `/customer`, `/customer/orders`, `/customer/profile`, `/customer/pickup`, `/customer/stores?type&mode`, `/customer/new-order?storeId&mode`, `/customer/order/[id]`.

- [ ] **Step 1: Layouts**

```bash
git rm src/app/customer/index.tsx
```

`src/app/customer/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

export default function CustomerLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="pickup" options={{ title: 'Pickup' }} />
      <Stack.Screen name="stores" options={{ title: 'Choose a store' }} />
      <Stack.Screen name="new-order" options={{ title: 'New order' }} />
      <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
    </Stack>
  );
}
```

`src/app/customer/(tabs)/_layout.tsx`:
```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

export default function CustomerTabs() {
  const colors = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```
If `sf`/`md` props fail typecheck in this SDK, use `src={require('@/assets/images/tabIcons/home.png')} renderingMode="template"` for every icon instead (as the template did).

- [ ] **Step 2: Tab screens**

`src/app/customer/(tabs)/index.tsx`:
```tsx
import { router } from 'expo-router';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';

export default function CustomerHome() {
  const { state } = useAuth();
  const name = state.status === 'signedIn' ? state.user.name : '';

  return (
    <Screen>
      <ThemedText type="subtitle">Hi, {name}</ThemedText>
      <ThemedText themeColor="textSecondary">What do you need today?</ThemedText>
      <Card onPress={() => router.push('/customer/pickup')}>
        <ThemedText type="smallBold">Pickup</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          We pick up food or finished laundry from a store and bring it to you.
        </ThemedText>
      </Card>
      <Card onPress={() => router.push({ pathname: '/customer/stores', params: { type: 'laundry', mode: 'dropoff' } })}>
        <ThemedText type="smallBold">Drop off</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          We collect your laundry and drop it at the laundry shop you choose.
        </ThemedText>
      </Card>
    </Screen>
  );
}
```

`src/app/customer/(tabs)/orders.tsx`:
```tsx
import { router } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useMyOrders } from '@/hooks/queries';

export default function MyOrders() {
  const orders = useMyOrders();

  return (
    <Screen onRefresh={orders.refetch}>
      <ThemedText type="subtitle">Orders</ThemedText>
      {orders.isPending && <ActivityIndicator />}
      <ErrorText error={orders.error} />
      {orders.data?.length === 0 && <ThemedText themeColor="textSecondary">No orders yet.</ThemedText>}
      {orders.data?.map((order) => (
        <Card key={order.id} onPress={() => router.push(`/customer/order/${order.id}`)}>
          <OrderSummary order={order} />
        </Card>
      ))}
    </Screen>
  );
}
```

`src/app/customer/(tabs)/profile.tsx`:
```tsx
import { ProfileScreen } from '@/components/profile-screen';

export default ProfileScreen;
```

- [ ] **Step 3: Pickup type choice and store list**

`src/app/customer/pickup.tsx`:
```tsx
import { router } from 'expo-router';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import type { StoreType } from '@/lib/types';

const OPTIONS: { type: StoreType; title: string; body: string }[] = [
  { type: 'food', title: 'Food', body: 'Milk tea, burgers, meals — we pick it up from the restaurant.' },
  { type: 'laundry', title: 'Laundry', body: 'Your laundry is done — we bring it home from the shop.' },
];

export default function Pickup() {
  return (
    <Screen edges={[]}>
      {OPTIONS.map((option) => (
        <Card
          key={option.type}
          onPress={() => router.push({ pathname: '/customer/stores', params: { type: option.type, mode: 'pickup' } })}>
          <ThemedText type="smallBold">{option.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {option.body}
          </ThemedText>
        </Card>
      ))}
    </Screen>
  );
}
```

`src/app/customer/stores.tsx`:
```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useStores } from '@/hooks/queries';
import type { OrderType, StoreType } from '@/lib/types';

export default function StoreList() {
  const { type, mode } = useLocalSearchParams<{ type: StoreType; mode: OrderType }>();
  const stores = useStores(type);

  return (
    <Screen edges={[]} onRefresh={stores.refetch}>
      {stores.isPending && <ActivityIndicator />}
      <ErrorText error={stores.error} />
      {stores.data?.map((store) => (
        <Card
          key={store.id}
          onPress={() => router.push({ pathname: '/customer/new-order', params: { storeId: String(store.id), mode } })}>
          <ThemedText type="smallBold">{store.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {store.address}
          </ThemedText>
        </Card>
      ))}
    </Screen>
  );
}
```

- [ ] **Step 4: New order form** — `src/app/customer/new-order.tsx`

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useStore } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { peso } from '@/lib/format';
import type { OrderType } from '@/lib/types';

export default function NewOrder() {
  const params = useLocalSearchParams<{ storeId: string; mode: OrderType }>();
  const storeId = Number(params.storeId);
  const store = useStore(storeId);
  const createOrder = useCreateOrder();
  const [qty, setQty] = useState<Record<number, number>>({});
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
  const isFood = type === 'food';
  const items = menu.filter((m) => (qty[m.id] ?? 0) > 0).map((m) => ({ menu_item_id: m.id, qty: qty[m.id] }));
  const itemsTotal = menu.reduce((sum, m) => sum + m.price * (qty[m.id] ?? 0), 0);
  const change = (id: number, delta: number) =>
    setQty((q) => ({ ...q, [id]: Math.min(50, Math.max(0, (q[id] ?? 0) + delta)) }));

  const submit = () =>
    createOrder.mutate(
      { type: params.mode, store_id: storeId, items, customer_address: address, notes },
      { onSuccess: (order) => router.replace(`/customer/order/${order.id}`) },
    );

  return (
    <Screen edges={[]}>
      <View>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {storeAddress}
        </ThemedText>
      </View>
      {isFood &&
        menu.map((item) => (
          <Card key={item.id}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <ThemedText type="small">{item.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {peso(item.price)}
                </ThemedText>
              </View>
              <Stepper value={qty[item.id] ?? 0} onChange={(delta) => change(item.id, delta)} />
            </View>
          </Card>
        ))}
      <TextField
        label={params.mode === 'dropoff' ? 'Your address (we collect here)' : 'Delivery address'}
        value={address}
        onChangeText={setAddress}
        multiline
      />
      <TextField
        label="Notes"
        placeholder={isFood ? 'e.g. less ice, no onions' : 'e.g. claim ticket #, number of bags'}
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      {isFood && <ThemedText type="smallBold">Items: {peso(itemsTotal)} + delivery fee</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">
        Pay cash to the driver.
      </ThemedText>
      <ErrorText error={createOrder.error} />
      <Button title="Place order" onPress={submit} loading={createOrder.isPending} disabled={isFood && items.length === 0} />
    </Screen>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (delta: number) => void }) {
  const theme = useTheme();
  const step = (symbol: string, delta: number) => (
    <Pressable onPress={() => onChange(delta)} style={[styles.step, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">{symbol}</ThemedText>
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
  grow: { flex: 1 },
  step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 24, textAlign: 'center' },
});
```

- [ ] **Step 5: Order detail** — `src/app/customer/order/[id].tsx`

```tsx
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { useCancelOrder, useOrder } from '@/hooks/queries';

export default function OrderScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const order = useOrder(id);
  const cancel = useCancelOrder(id);

  if (order.isPending) {
    return (
      <Screen edges={[]}>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (order.isError) {
    return (
      <Screen edges={[]}>
        <ErrorText error={order.error} />
      </Screen>
    );
  }

  const o = order.data;
  return (
    <Screen edges={[]} onRefresh={order.refetch}>
      <StatusTimeline status={o.status} />
      <Card>
        <OrderSummary order={o} />
      </Card>
      {o.driver_name && (
        <Card>
          <ThemedText type="smallBold">Driver</ThemedText>
          <ThemedText type="small">
            {o.driver_name} · {o.driver_phone}
          </ThemedText>
        </Card>
      )}
      <ErrorText error={cancel.error} />
      {o.status === 'pending' && (
        <Button title="Cancel order" variant="danger" onPress={() => cancel.mutate()} loading={cancel.isPending} />
      )}
    </Screen>
  );
}
```

- [ ] **Step 6: Typecheck, lint, manual run**

Run: `npx tsc --noEmit && yarn lint`
Expected: no errors.

Manual (worker running): as a customer —
1. Pickup → Food → Tea Haven → add 2 Wintermelon → address → Place order → order screen shows "Waiting for a driver", items, Total ₱290.00.
2. Pickup → Laundry → Fresh Fold → address + notes → order total ₱50.00.
3. Drop off → Bubble Wash → order shows From: your address, To: shop address.
4. Cancel a pending order → shows Cancelled; Orders tab lists all three, newest first.

- [ ] **Step 7: Commit**

```bash
git add -A -- . ':!worker'
git commit -m "feat(app): customer pickup, drop off, and order tracking"
```

---

### Task 9: Driver screens

**Files:**
- Rewrite: `src/app/driver/_layout.tsx`, `src/app/driver/index.tsx`
- Create: `src/app/driver/active.tsx`, `history.tsx`, `profile.tsx`

**Interfaces:**
- Consumes: `useAvailableJobs`, `useActiveJob`, `useAcceptJob`, `useAdvanceJob`, `useJobHistory`, Task 7 components.
- Produces: routes `/driver` (available), `/driver/active`, `/driver/history`, `/driver/profile`.

- [ ] **Step 1: Tabs layout** — `src/app/driver/_layout.tsx`

```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

export default function DriverTabs() {
  const colors = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Available</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.full.fill" md="inbox" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="active">
        <NativeTabs.Trigger.Label>Active</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="shippingbox.fill" md="local_shipping" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.fill" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```
(Same icon fallback rule as Task 8 Step 1.)

- [ ] **Step 2: Available jobs** — `src/app/driver/index.tsx`

```tsx
import { router } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useAcceptJob, useActiveJob, useAvailableJobs } from '@/hooks/queries';

export default function AvailableJobs() {
  const jobs = useAvailableJobs();
  const active = useActiveJob();
  const accept = useAcceptJob();
  const busy = Boolean(active.data);

  return (
    <Screen onRefresh={jobs.refetch}>
      <ThemedText type="subtitle">Available jobs</ThemedText>
      {busy && <ThemedText themeColor="textSecondary">Finish your active job before accepting another.</ThemedText>}
      {jobs.isPending && <ActivityIndicator />}
      <ErrorText error={jobs.error ?? accept.error} />
      {jobs.data?.length === 0 && (
        <ThemedText themeColor="textSecondary">No jobs right now. This list refreshes automatically.</ThemedText>
      )}
      {jobs.data?.map((job) => (
        <Card key={job.id}>
          <OrderSummary order={job} />
          <Button
            title="Accept job"
            disabled={busy}
            loading={accept.isPending && accept.variables === job.id}
            onPress={() => accept.mutate(job.id, { onSuccess: () => router.navigate('/driver/active') })}
          />
        </Card>
      ))}
    </Screen>
  );
}
```

- [ ] **Step 3: Active job** — `src/app/driver/active.tsx`

```tsx
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { useActiveJob, useAdvanceJob } from '@/hooks/queries';
import type { OrderDetail } from '@/lib/types';

function nextStep(job: OrderDetail) {
  if (job.status === 'accepted') {
    return {
      status: 'picked_up' as const,
      label: job.type === 'pickup' ? `Picked up at ${job.store_name}` : 'Collected laundry from customer',
    };
  }
  if (job.status === 'picked_up') {
    return {
      status: 'delivered' as const,
      label: job.type === 'pickup' ? 'Delivered to customer' : `Dropped off at ${job.store_name}`,
    };
  }
  return null;
}

export default function ActiveJob() {
  const active = useActiveJob();
  const advance = useAdvanceJob();
  const job = active.data;

  if (active.isPending) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!job) {
    return (
      <Screen onRefresh={active.refetch}>
        <ThemedText type="subtitle">Active job</ThemedText>
        <ErrorText error={active.error} />
        <ThemedText themeColor="textSecondary">No active job. Accept one from Available.</ThemedText>
      </Screen>
    );
  }

  const step = nextStep(job);
  return (
    <Screen onRefresh={active.refetch}>
      <ThemedText type="subtitle">Active job</ThemedText>
      <StatusTimeline status={job.status} />
      <Card>
        <OrderSummary order={job} />
      </Card>
      <Card>
        <ThemedText type="smallBold">Customer</ThemedText>
        <ThemedText type="small">
          {job.customer_name} · {job.customer_phone}
        </ThemedText>
      </Card>
      <ErrorText error={advance.error} />
      {step && (
        <Button
          title={step.label}
          onPress={() => advance.mutate({ id: job.id, status: step.status })}
          loading={advance.isPending}
        />
      )}
    </Screen>
  );
}
```

- [ ] **Step 4: History and profile**

`src/app/driver/history.tsx`:
```tsx
import { ActivityIndicator } from 'react-native';

import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useJobHistory } from '@/hooks/queries';

export default function JobHistory() {
  const history = useJobHistory();

  return (
    <Screen onRefresh={history.refetch}>
      <ThemedText type="subtitle">History</ThemedText>
      {history.isPending && <ActivityIndicator />}
      <ErrorText error={history.error} />
      {history.data?.length === 0 && <ThemedText themeColor="textSecondary">No completed jobs yet.</ThemedText>}
      {history.data?.map((job) => (
        <Card key={job.id}>
          <OrderSummary order={job} />
        </Card>
      ))}
    </Screen>
  );
}
```

`src/app/driver/profile.tsx`:
```tsx
import { ProfileScreen } from '@/components/profile-screen';

export default ProfileScreen;
```

- [ ] **Step 5: Typecheck, lint, manual run**

Run: `npx tsc --noEmit && yarn lint`
Expected: no errors.

Manual, two simulators/devices (or sign out/in between roles):
1. Customer places a food pickup.
2. Driver sees it on Available within ~5 s → Accept → lands on Active.
3. Customer order screen shows "Driver accepted" plus driver name/phone within ~5 s; Cancel button gone.
4. Driver taps "Picked up at …" then "Delivered to customer" → Active empty; History lists it.
5. Customer screen shows Delivered.
6. With an active job, Available shows the "finish your active job" note and Accept is disabled.

- [ ] **Step 6: Commit**

```bash
git add -A -- . ':!worker'
git commit -m "feat(app): driver job board, active job, history"
```

---

### Task 10: Docs and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`** with:

````markdown
# Dryyt

Delivery app for food/laundry **Pickup** and laundry **Drop off**. Customers book; drivers deliver.

## Run locally

Backend (Cloudflare Worker + D1):

```bash
cd worker
yarn
cp .dev.vars.example .dev.vars   # set JWT_SECRET
yarn db:migrate:local
yarn dev                          # http://localhost:8787
yarn test
```

App (Expo):

```bash
yarn
cp .env.example .env              # set EXPO_PUBLIC_API_URL for your simulator/device
yarn ios                          # or yarn android
```

## Deploy the worker

```bash
cd worker
npx wrangler d1 create dryyt      # paste database_id into wrangler.jsonc
npx wrangler secret put JWT_SECRET
yarn db:migrate:remote
yarn deploy
```

Then set `EXPO_PUBLIC_API_URL` to the deployed `*.workers.dev` URL.
````

- [ ] **Step 2: Full verification**

Run:
```bash
cd worker && yarn test && yarn typecheck && cd .. && npx tsc --noEmit && yarn lint
```
Expected: all worker tests PASS; no type or lint errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: run and deploy instructions"
```
