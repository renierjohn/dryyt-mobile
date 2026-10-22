import { Hono } from 'hono';
import { z } from 'zod';
import type { Context } from 'hono';

import { requireAdmin, requireAuth, signToken } from '../lib/auth';
import { APP_FEE_TYPES, DEFAULT_CATEGORY, isVehicleCategory, RATE_TYPES } from '../lib/fees';
import { fail, parseBody } from '../lib/http';
import { photoResponse, readPhoto } from '../lib/photos';
import { STORE_TOTALS, storeRange } from '../lib/store-totals';
import { verifyTurnstile } from '../lib/turnstile';
import type { AppEnv } from '../types';
import { checkLogin, loginSchema } from './auth';

const PAGE_SIZE = 25;

/** Reads ?page= (1-based) and returns the LIMIT/OFFSET for it. */
function paging(c: Context) {
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
  return { page, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}

/**
 * One page of `select` filtered by `where` (AND-ed, each with one bound value, or none when it's undefined), plus the total count.
 * `from` is the FROM clause including joins; column names in `where` are trusted (never from the request).
 * `fromBinds` fill `?`s in `from` (a derived table; they come before the WHERE values).
 */
async function listData(c: Context<AppEnv>, select: string, from: string, where: [string, unknown][], orderBy: string, fromBinds: unknown[] = []) {
  const { page, limit, offset } = paging(c);
  const { clause, binds } = whereClause(where);
  const db = c.env.DB;
  const [rows, count] = await db.batch([
    db.prepare(`SELECT ${select} FROM ${from} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...fromBinds, ...binds, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM ${from} ${clause}`).bind(...fromBinds, ...binds),
  ]);
  return { rows: rows.results, total: (count.results[0] as { total: number }).total, page, page_size: limit };
}

function whereClause(where: [string, unknown][]) {
  return {
    clause: where.length > 0 ? `WHERE ${where.map(([sql]) => sql).join(' AND ')}` : '',
    binds: where.map(([, v]) => v).filter((v) => v !== undefined),
  };
}

const list = async (...args: Parameters<typeof listData>) => args[0].json(await listData(...args));

/** Adds a filter only when the query param is present. */
function filter(c: Context, where: [string, unknown][], param: string, sql: string, value = (v: string) => v as unknown) {
  const v = c.req.query(param)?.trim();
  if (v) where.push([sql, value(v)]);
}

const like = (v: string) => `%${v}%`;

const admin = new Hono<AppEnv>();

/**
 * Cpanel sign-in: a Turnstile check, then the usual credentials, and only admins get a token.
 * A wrong password and a non-admin account get the same 403, so the response never tells which emails are admins.
 * Registered before the auth middleware below, so it runs without a token.
 */
admin.post('/login', async (c) => {
  const raw = (await c.req.json().catch(() => undefined)) as { turnstile_token?: unknown } | undefined;
  await verifyTurnstile(c, raw?.turnstile_token, 'cpanel_login');
  const input = await parseBody(c, loginSchema);
  const user = await checkLogin(c.env.DB, input).catch(() => fail(403, 'Invalid email or password'));
  const row = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(user.id).first<{ is_admin: number }>();
  if (row?.is_admin !== 1) fail(403, 'Invalid email or password');
  return c.json({ token: await signToken(user, c.env.JWT_SECRET), user });
});

admin.use('*', requireAuth, requireAdmin);

admin.get('/me', async (c) => {
  const user = await c.env.DB.prepare('SELECT id, email, name, role FROM users WHERE id = ?').bind(c.get('user').id).first();
  return c.json({ user });
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const day = date.optional();
const rangeQuery = z.object({ from: day, to: day });

/** ?from= and ?to= (YYYY-MM-DD, Manila time, inclusive); open ends when left out. */
function dateRange(c: Context) {
  const range = rangeQuery.safeParse({ from: c.req.query('from') || undefined, to: c.req.query('to') || undefined });
  if (!range.success) fail(400, range.error.issues[0]?.message ?? 'Invalid date range');
  const from = range.data.from ?? '0000-01-01';
  const to = range.data.to ?? '9999-12-31';
  if (from > to) fail(400, 'from must be on or before to');
  return [from, to] as const;
}

/** Finished (delivered/completed) on a Manila calendar day in ?1..?2; updated_at is UTC and set when the job finished. */
const IN_RANGE = "date(updated_at, '+8 hours') BETWEEN ?1 AND ?2";

/**
 * Totals for the cpanel overview. Amounts are centavos. ?from= and ?to= (YYYY-MM-DD, Manila time, inclusive) narrow
 * the amounts only; the counts are always all-time.
 */
admin.get('/stats', async (c) => {
  const db = c.env.DB;
  const [from, to] = dateRange(c);
  const [users, orders, dropoffs, stores, revenue, appFee] = await db.batch([
    db.prepare('SELECT role AS key, COUNT(*) AS count FROM users GROUP BY role'),
    db.prepare('SELECT status AS key, COUNT(*) AS count FROM transactions_pickup GROUP BY status'),
    db.prepare('SELECT status AS key, COUNT(*) AS count FROM transactions_dropoff GROUP BY status'),
    db.prepare('SELECT type AS key, COUNT(*) AS count FROM stores GROUP BY type'),
    db.prepare(
      `SELECT
        (SELECT COALESCE(SUM(items_total + total_delivery_fee), 0) FROM transactions_pickup WHERE status = 'delivered' AND ${IN_RANGE}) AS orders_gross,
        (SELECT COALESCE(SUM(total_delivery_fee + COALESCE(laundry_fee, 0)), 0) FROM transactions_dropoff WHERE status = 'completed' AND ${IN_RANGE}) AS dropoffs_gross,
        -- The app's cut, on the same finished jobs as the gross totals.
        (SELECT COALESCE(SUM(service_fee), 0) FROM transactions_pickup WHERE status = 'delivered' AND ${IN_RANGE}) AS orders_service_fees,
        (SELECT COALESCE(SUM(service_fee), 0) FROM transactions_dropoff WHERE status = 'completed' AND ${IN_RANGE}) AS dropoffs_service_fees,
        (SELECT COUNT(*) FROM drivers WHERE online = 1) AS drivers_online`,
    ).bind(from, to),
    // What every store owes the app under its fee setting (flat, or % of sales) for the same range, as on the Stores tab.
    db.prepare(`SELECT COALESCE(SUM(s.app_fee), 0) AS app_fee FROM ${STORE_TOTALS}`).bind(...storeRange([from, to])),
  ]);
  const byKey = (r: D1Result) => Object.fromEntries((r.results as { key: string; count: number }[]).map((x) => [x.key, x.count]));
  return c.json({ users: byKey(users), orders: byKey(orders), dropoffs: byKey(dropoffs), stores: byKey(stores), ...(revenue.results[0] as Record<string, number>), ...(appFee.results[0] as { app_fee: number }) });
});

/** ?from= and ?to= (YYYY-MM-DD, Manila time, inclusive) on `${alias}.created_at`, when given. */
function createdBetween(c: Context, where: [string, unknown][], alias: string) {
  const [from, to] = dateRange(c);
  if (c.req.query('from')) where.push([`date(${alias}.created_at, '+8 hours') >= ?`, from]);
  if (c.req.query('to')) where.push([`date(${alias}.created_at, '+8 hours') <= ?`, to]);
}

admin.get('/orders', async (c) => {
  const where: [string, unknown][] = [];
  filter(c, where, 'status', 'o.status = ?');
  filter(c, where, 'store_id', 'o.store_id = ?', Number);
  filter(c, where, 'q', "(cu.name || ' ' || cu.email) LIKE ?", like);
  createdBetween(c, where, 'o');
  const from = 'transactions_pickup o JOIN stores s ON s.id = o.store_id JOIN users cu ON cu.id = o.customer_id LEFT JOIN users dr ON dr.id = o.driver_id';
  const { clause, binds } = whereClause(where);
  const [page, totals] = await Promise.all([
    listData(
      c,
      `o.id, o.status, o.customer_address, o.items_total, o.road_km, o.delivery_fee, o.service_fee, o.total_delivery_fee, o.payment_ref, o.created_at, o.updated_at,
     s.id AS store_id, s.name AS store_name, s.type AS store_type, cu.name AS customer_name, cu.phone AS customer_phone,
     dr.name AS driver_name`,
      from,
      where,
      'o.id DESC',
    ),
    // Fees of the listed orders, leaving out cancelled ones.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(o.total_delivery_fee), 0) AS total_delivery_fee, COALESCE(SUM(o.service_fee), 0) AS total_service_fee
       FROM ${from} ${clause ? `${clause} AND` : 'WHERE'} o.status NOT IN ('cancelled')`,
    )
      .bind(...binds)
      .first(),
  ]);
  return c.json({ ...page, ...totals });
});

admin.get('/dropoffs', async (c) => {
  const where: [string, unknown][] = [];
  filter(c, where, 'status', 't.status = ?');
  filter(c, where, 'store_id', 't.store_id = ?', Number);
  filter(c, where, 'q', "(cu.name || ' ' || cu.email) LIKE ?", like);
  createdBetween(c, where, 't');
  const from = 'transactions_dropoff t JOIN stores s ON s.id = t.store_id JOIN users cu ON cu.id = t.customer_id LEFT JOIN users dr ON dr.id = t.driver_id';
  const { clause, binds } = whereClause(where);
  const [page, totals] = await Promise.all([
    listData(
      c,
      `t.id, t.status, t.customer_address, t.road_km, t.delivery_fee, t.service_fee, t.total_delivery_fee, t.laundry_fee, t.created_at,
     s.id AS store_id, s.name AS store_name, cu.name AS customer_name, cu.phone AS customer_phone, dr.name AS driver_name`,
      from,
      where,
      't.id DESC',
    ),
    // Fees of the listed drop offs, leaving out cancelled and expired ones.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(t.total_delivery_fee), 0) AS total_delivery_fee, COALESCE(SUM(t.service_fee), 0) AS total_service_fee
       FROM ${from} ${clause ? `${clause} AND` : 'WHERE'} t.status NOT IN ('cancelled', 'expired')`,
    )
      .bind(...binds)
      .first(),
  ]);
  return c.json({ ...page, ...totals });
});

admin.get('/users', (c) => {
  const where: [string, unknown][] = [];
  filter(c, where, 'role', 'u.role = ?');
  filter(c, where, 'q', "(u.name || ' ' || u.email || ' ' || u.phone) LIKE ?", like);
  return list(
    c,
    `u.id, u.email, u.name, u.phone, u.role, u.is_admin, u.blocked, u.created_at, d.online, d.busy, dd.status AS verified`,
    'users u LEFT JOIN drivers d ON d.user_id = u.id LEFT JOIN driver_data dd ON dd.user_id = u.id',
    where,
    'u.id DESC',
  );
});

/** ?status= for the Users (customers) and Owners tabs. */
const ACCOUNT_FILTERS: Record<string, string> = { active: 'u.blocked = 0', blocked: 'u.blocked = 1' };

/** Accounts of one role, with an optional ?status= (active/blocked) and ?q= search. */
function roleWhere(c: Context, role: 'customer' | 'owner') {
  const where: [string, unknown][] = [[`u.role = '${role}'`, undefined]];
  const status = ACCOUNT_FILTERS[c.req.query('status') ?? ''];
  if (status) where.push([status, undefined]);
  filter(c, where, 'q', "(u.name || ' ' || u.email || ' ' || u.phone) LIKE ?", like);
  return where;
}

/** Customer accounts with how many pickups and drop offs each has booked. */
admin.get('/customers', (c) =>
  list(
    c,
    `u.id, u.email, u.name, u.phone, u.is_admin, u.blocked, u.created_at,
     (SELECT COUNT(*) FROM transactions_pickup WHERE customer_id = u.id) AS order_count,
     (SELECT COUNT(*) FROM transactions_dropoff WHERE customer_id = u.id) AS dropoff_count`,
    'users u',
    roleWhere(c, 'customer'),
    'u.id DESC',
  ),
);

/** Shop owner accounts with their stores. */
admin.get('/owners', (c) =>
  list(
    c,
    `u.id, u.email, u.name, u.phone, u.is_admin, u.blocked, u.created_at,
     u.maxstore, (SELECT COUNT(*) FROM stores WHERE owner_id = u.id) AS store_count,
     (SELECT GROUP_CONCAT(name, ', ') FROM stores WHERE owner_id = u.id) AS store_names,
     f.amount AS last_fee_amount, f.type AS last_fee_type, f.date_paid AS last_fee_paid, f.next_due_date AS next_due_date,
     (SELECT COUNT(*) FROM app_fee WHERE user_id = u.id AND type IS NULL) AS fees_to_review`,
    // Their latest reviewed app fee payment, if any (proofs the owner sent have no type until an admin fills it in).
    `users u LEFT JOIN app_fee f ON f.id = (SELECT id FROM app_fee WHERE user_id = u.id AND type IS NOT NULL ORDER BY date_paid DESC, id DESC LIMIT 1)`,
    roleWhere(c, 'owner'),
    'u.id DESC',
  ),
);

/** `type` is NULL on a proof the owner sent from the app, until an admin fills in the payment. */
const FEE_SELECT =
  'SELECT id, user_id, amount, type, payment_type, date_paid, next_due_date, created_at, ref_number, photo IS NOT NULL AS has_photo FROM app_fee';
const toFee = (f: Record<string, unknown>) => ({ ...f, has_photo: Boolean(f.has_photo) });

/** The owner's id from the URL, or 404 when it isn't an owner. */
async function ownerId(c: Context<AppEnv>) {
  const id = Number(c.req.param('id'));
  const row = Number.isInteger(id) && id > 0 ? await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'owner'").bind(id).first() : null;
  if (!row) fail(404, 'Owner not found');
  return id;
}

/** An owner's stores with their service fees and app fees (and fee settings) for ?from=..?to=, the totals, and their store limit. */
admin.get('/owners/:id/stores', async (c) => {
  const id = await ownerId(c);
  const range = storeRange(dateRange(c));
  const db = c.env.DB;
  const [stores, totals, owner] = await db.batch([
    db.prepare(`SELECT s.* FROM ${STORE_TOTALS} WHERE s.owner_id = ? ORDER BY s.id`).bind(...range, id),
    db.prepare(`SELECT ${STORE_TOTALS_SUM} FROM ${STORE_TOTALS} WHERE s.owner_id = ?`).bind(...range, id),
    db.prepare('SELECT maxstore FROM users WHERE id = ?').bind(id),
  ]);
  return c.json({ stores: stores.results, ...(totals.results[0] as object), ...(owner.results[0] as object) });
});

const feeSettingsSchema = z.object({
  fee_type: z.union([z.literal(1), z.literal(2)]),
  fee_flat: z.number().int().min(0).max(100_000_000),
  fee_percentage: z.number().min(0).max(100),
});

/** A store's app fee: 1 flat (fee_flat centavos) or 2 percentage (fee_percentage % of the store's sales). */
admin.post('/stores/:id/fee', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) fail(404, 'Store not found');
  const input = await parseBody(c, feeSettingsSchema);
  const fee = await c.env.DB.prepare(
    'UPDATE stores SET fee_type = ?, fee_flat = ?, fee_percentage = ? WHERE id = ? RETURNING id, fee_type, fee_flat, fee_percentage',
  )
    .bind(input.fee_type, input.fee_flat, input.fee_percentage, id)
    .first();
  if (!fee) fail(404, 'Store not found');
  console.log('[admin] store fee set', { by: c.get('user').id, store: id, ...input });
  return c.json({ fee });
});

/** How many stores the owner may run. Lowering it below their current count keeps those stores; they just can't add more. */
admin.post('/owners/:id/maxstore', async (c) => {
  const id = await ownerId(c);
  const { maxstore } = await parseBody(c, z.object({ maxstore: z.number().int().min(0).max(100) }));
  await c.env.DB.prepare('UPDATE users SET maxstore = ? WHERE id = ?').bind(maxstore, id).run();
  console.log('[admin] maxstore set', { by: c.get('user').id, owner: id, maxstore });
  return c.json({ maxstore });
});

/** An owner's app fee (subscription) payments, newest first. */
admin.get('/owners/:id/fees', async (c) => {
  const id = await ownerId(c);
  const { results } = await c.env.DB.prepare(`${FEE_SELECT} WHERE user_id = ? ORDER BY date_paid DESC, id DESC`).bind(id).all();
  return c.json({ fees: results.map(toFee) });
});

const feeSchema = z
  .object({
    amount: z.number().int().positive().max(100_000_000),
    type: z.enum(APP_FEE_TYPES),
    payment_type: z.string().trim().min(1, 'payment_type: required').max(40),
    date_paid: date,
    next_due_date: date.nullish(),
  })
  .refine((f) => !f.next_due_date || f.next_due_date > f.date_paid, { message: 'next_due_date must be after date_paid' });

/** Records an app fee payment from an owner. Amounts are centavos. */
admin.post('/owners/:id/fees', async (c) => {
  const id = await ownerId(c);
  const input = await parseBody(c, feeSchema);
  const row = await c.env.DB.prepare(
    `INSERT INTO app_fee (user_id, amount, type, payment_type, date_paid, next_due_date) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(id, input.amount, input.type, input.payment_type, input.date_paid, input.next_due_date ?? null)
    .first<{ id: number }>();
  console.log('[admin] app fee recorded', { by: c.get('user').id, owner: id, ...input });
  return c.json({ fee: await getFee(c.env.DB, row!.id) }, 201);
});

const getFee = async (db: D1Database, id: number) => {
  const f = await db.prepare(`${FEE_SELECT} WHERE id = ?`).bind(id).first();
  return f ? toFee(f) : null;
};

/** The photo an owner sent as proof of an app fee payment. */
admin.get('/app-fee/:id/photo', async (c) => {
  const row = await c.env.DB.prepare('SELECT photo FROM app_fee WHERE id = ?').bind(Number(c.req.param('id'))).first<{ photo: string | null }>();
  return photoResponse(c.env.PROOFS, row?.photo, 'no-store');
});

/** Fills in (or corrects) a payment, e.g. a proof the owner sent: amount, type, how it was paid, and the dates. */
admin.post('/app-fee/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const input = await parseBody(c, feeSchema);
  const { meta } = await c.env.DB.prepare('UPDATE app_fee SET amount = ?, type = ?, payment_type = ?, date_paid = ?, next_due_date = ? WHERE id = ?')
    .bind(input.amount, input.type, input.payment_type, input.date_paid, input.next_due_date ?? null, Number.isInteger(id) ? id : 0)
    .run();
  if (meta.changes === 0) fail(404, 'Payment not found');
  console.log('[admin] app fee reviewed', { by: c.get('user').id, fee: id, ...input });
  return c.json({ fee: await getFee(c.env.DB, id) });
});

/** Filters for the Drivers tab (?status=). */
const DRIVER_FILTERS: Record<string, string> = {
  verified: 'COALESCE(dd.status, 0) = 1',
  unverified: 'COALESCE(dd.status, 0) = 0',
  online: 'COALESCE(d.online, 0) = 1',
  blocked: 'u.blocked = 1',
};

/** Driver accounts with their driver_data (verification, photos, earnings). Photo keys stay server-side. */
admin.get('/drivers', (c) => {
  const where: [string, unknown][] = [["u.role = 'driver'", undefined]];
  const status = DRIVER_FILTERS[c.req.query('status') ?? ''];
  if (status) where.push([status, undefined]);
  filter(c, where, 'q', "(u.name || ' ' || u.email || ' ' || u.phone) LIKE ?", like);
  return list(
    c,
    `u.id, u.email, u.name, u.phone, u.blocked, u.created_at, d.online, d.busy, d.updated_at AS seen_at,
     dd.photo_face IS NOT NULL AS has_face, dd.photo_id IS NOT NULL AS has_id, dd.face_check, COALESCE(dd.notes, '') AS notes, dd.vehicle_type,
     COALESCE(dd.status, 0) AS verified, COALESCE(dd.earnings, 0) AS earnings, dd.updated_at AS data_updated_at`,
    'users u LEFT JOIN drivers d ON d.user_id = u.id LEFT JOIN driver_data dd ON dd.user_id = u.id',
    where,
    'u.id DESC',
  );
});

/** URL kind → driver_data photo column, as in routes/drivers.ts. */
const DRIVER_PHOTOS = { face: 'photo_face', id: 'photo_id' } as const;

/** The driver's id and the photo column from the URL, or 404. */
async function driverPhoto(c: Context<AppEnv>) {
  const id = Number(c.req.param('id'));
  const kind = c.req.param('kind') ?? '';
  if (!(kind in DRIVER_PHOTOS) || !Number.isInteger(id) || id <= 0) fail(404, 'Not found');
  const row = await c.env.DB.prepare(
    "SELECT dd.photo_face, dd.photo_id FROM users u LEFT JOIN driver_data dd ON dd.user_id = u.id WHERE u.id = ? AND u.role = 'driver'",
  )
    .bind(id)
    .first<{ photo_face: string | null; photo_id: string | null }>();
  if (!row) fail(404, 'Driver not found');
  const column = DRIVER_PHOTOS[kind as keyof typeof DRIVER_PHOTOS];
  return { id, kind, column, key: row[column] };
}

/** A driver's face or license photo, for review. Never cached: an edit replaces it. */
admin.get('/drivers/:id/photo/:kind', async (c) => {
  const { key } = await driverPhoto(c);
  return photoResponse(c.env.PROOFS, key, 'no-store');
});

/**
 * Replaces a driver's photo with an edited copy (e.g. parts blurred out), even once verified. The original is deleted,
 * so blurred details are gone for good. The new key changes the photo version, so the app shows the new one.
 */
admin.post('/drivers/:id/photo/:kind', async (c) => {
  const { id, kind, column, key: old } = await driverPhoto(c);
  if (!old) fail(404, 'No photo yet');
  const { body, type, ext } = await readPhoto(c);
  const key = `driver/${id}/${kind}-${crypto.randomUUID()}.${ext}`;
  await c.env.PROOFS.put(key, body, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare(`UPDATE driver_data SET ${column} = ?, updated_at = datetime('now') WHERE user_id = ?`).bind(key, id).run();
  c.executionCtx.waitUntil(c.env.PROOFS.delete(old));
  console.log('[admin] driver photo edited', { by: c.get('user').id, driver: id, kind });
  return c.json({ ok: true });
});

/** Verifies a driver (badge on, details locked) or unverifies them, like `bun run driver:verify [--off]`. */
admin.post('/drivers/:id/verified', async (c) => {
  const id = Number(c.req.param('id'));
  const { verified } = await parseBody(c, z.object({ verified: z.boolean() }));
  const isDriver = Number.isInteger(id) && id > 0 && (await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'driver'").bind(id).first());
  if (!isDriver) fail(404, 'Driver not found');
  await c.env.DB.prepare(
    `INSERT INTO driver_data (user_id, status) VALUES (?, ?)
     ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
  )
    .bind(id, verified ? 1 : 0)
    .run();
  console.log('[admin] driver verified', { by: c.get('user').id, driver: id, verified });
  return c.json({ verified });
});

/** Blocks or unblocks an account: a blocked user can't sign in. Admins can't block themselves. */
admin.post('/users/:id/blocked', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) fail(404, 'User not found');
  const { blocked } = await parseBody(c, z.object({ blocked: z.boolean() }));
  if (blocked && id === c.get('user').id) fail(400, "You can't block your own account");
  const user = await c.env.DB.prepare('UPDATE users SET blocked = ? WHERE id = ? RETURNING id, blocked').bind(blocked ? 1 : 0, id).first();
  if (!user) fail(404, 'User not found');
  console.log('[admin] user blocked', { by: c.get('user').id, id, blocked });
  return c.json({ user });
});

const STORE_TOTALS_SUM = 'COALESCE(SUM(s.service_fee), 0) AS total_service_fee, COALESCE(SUM(s.app_fee), 0) AS total_app_fee';

/** Stores with their service fees and app fees for ?from=..?to=, plus totals across every store matching the filters. */
admin.get('/stores', async (c) => {
  const where: [string, unknown][] = [];
  filter(c, where, 'type', 's.type = ?');
  filter(c, where, 'q', "(s.name || ' ' || s.address) LIKE ?", like);
  const range = storeRange(dateRange(c));
  const { clause, binds } = whereClause(where);
  const [page, totals] = await Promise.all([
    listData(c, 's.*', STORE_TOTALS, where, 's.id DESC', range),
    c.env.DB.prepare(`SELECT ${STORE_TOTALS_SUM} FROM ${STORE_TOTALS} ${clause}`)
      .bind(...range, ...binds)
      .first<{ total_service_fee: number; total_app_fee: number }>(),
  ]);
  return c.json({ ...page, ...totals });
});

/** Delivery rates per area (stores.group_id), service (type) and vehicle (category), with how many stores use each area. Amounts are centavos. */
admin.get('/rates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.group_id, r.type, r.category, r.base_fee, r.rate_per_km, r.commission_pct,
       (SELECT COUNT(*) FROM stores s WHERE s.group_id = r.group_id) AS store_count
     FROM rates r ORDER BY r.group_id = 'default' DESC, r.group_id, r.type, r.category = 2 DESC, r.category`,
  ).all();
  return c.json({ rates: results });
});

const rateSchema = z.object({
  group_id: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/, 'Use 1–40 lowercase letters, numbers, - or _'),
  type: z.enum(RATE_TYPES),
  category: z.number().int().refine(isVehicleCategory, 'Unknown vehicle category').default(DEFAULT_CATEGORY),
  base_fee: z.number().int().min(0).max(1_000_000),
  rate_per_km: z.number().int().min(0).max(100_000),
  commission_pct: z.number().min(0).max(100),
});

/** Creates or updates the rate for an area, service and vehicle. New quotes use it at once; orders already placed keep their fees. */
admin.post('/rates', async (c) => {
  const input = await parseBody(c, rateSchema);
  const rate = await c.env.DB.prepare(
    `INSERT INTO rates (group_id, type, category, base_fee, rate_per_km, commission_pct) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (group_id, type, category) DO UPDATE SET base_fee = excluded.base_fee, rate_per_km = excluded.rate_per_km, commission_pct = excluded.commission_pct
     RETURNING id, group_id, type, category, base_fee, rate_per_km, commission_pct`,
  )
    .bind(input.group_id, input.type, input.category, input.base_fee, input.rate_per_km, input.commission_pct)
    .first();
  console.log('[admin] rate saved', { by: c.get('user').id, ...input });
  return c.json({ rate });
});

/**
 * Edits one rate in place, including its service (type) and vehicle (category); the area stays. 409 when the area
 * already has a rate for that service and vehicle, or when moving away the motorcycle rate bookings price with.
 */
admin.post('/rates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const input = await parseBody(c, rateSchema.omit({ group_id: true }));
  const db = c.env.DB;
  const old = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT group_id, type, category FROM rates WHERE id = ?').bind(id).first<{ group_id: string; type: string; category: number }>() : null;
  if (!old) fail(404, 'Rate not found');
  const moved = old.type !== input.type || old.category !== input.category;
  if (moved && old.category === DEFAULT_CATEGORY) {
    fail(409, 'Bookings use this motorcycle rate. Add a new rate for the other service or vehicle instead.');
  }
  if (moved) {
    const taken = await db
      .prepare('SELECT 1 FROM rates WHERE group_id = ? AND type = ? AND category = ? AND id != ?')
      .bind(old.group_id, input.type, input.category, id)
      .first();
    if (taken) fail(409, 'This area already has a rate for that service and vehicle');
  }
  const rate = await db
    .prepare(
      `UPDATE rates SET type = ?, category = ?, base_fee = ?, rate_per_km = ?, commission_pct = ? WHERE id = ?
       RETURNING id, group_id, type, category, base_fee, rate_per_km, commission_pct`,
    )
    .bind(input.type, input.category, input.base_fee, input.rate_per_km, input.commission_pct, id)
    .first();
  console.log('[admin] rate edited', { by: c.get('user').id, id, from: old, ...input });
  return c.json({ rate });
});

/**
 * Deletes a rate nothing references. Bookings price with an area's motorcycle rates, so those can only go once no store
 * is in the area; other vehicles' rates aren't used by bookings yet and can always go.
 */
admin.post('/rates/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const rate = Number.isInteger(id) && id > 0
    ? await db.prepare('SELECT group_id, type, category FROM rates WHERE id = ?').bind(id).first<{ group_id: string; type: string; category: number }>()
    : null;
  if (!rate) fail(404, 'Rate not found');
  if (rate.category === DEFAULT_CATEGORY) {
    const stores = await db.prepare('SELECT COUNT(*) AS n FROM stores WHERE group_id = ?').bind(rate.group_id).first<{ n: number }>();
    if (stores!.n > 0) fail(409, `${stores!.n} store${stores!.n === 1 ? ' uses' : 's use'} this rate. Move them to another area first.`);
  }
  await db.prepare('DELETE FROM rates WHERE id = ?').bind(id).run();
  console.log('[admin] rate deleted', { by: c.get('user').id, id, ...rate });
  return c.json({ deleted: id });
});

/** One store's details for the Stores tab: logo, payment QR codes (up to 3) and map location. */
admin.get('/stores/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = Number.isInteger(id) && id > 0
    ? await c.env.DB.prepare(
        `SELECT s.id, s.name, s.type, s.address, s.group_id, s.lat, s.lng, s.store_logo, s.store_payment_gateway,
           ow.name AS owner_name, ow.email AS owner_email, ow.phone AS owner_phone
         FROM stores s LEFT JOIN users ow ON ow.id = s.owner_id WHERE s.id = ?`,
      )
        .bind(id)
        .first<{ store_payment_gateway: string } & Record<string, unknown>>()
    : null;
  if (!row) fail(404, 'Store not found');
  let gateways: unknown = [];
  try {
    gateways = JSON.parse(row.store_payment_gateway);
  } catch {
    // Bad JSON shows as none rather than breaking the page.
  }
  return c.json({ store: { ...row, store_payment_gateway: Array.isArray(gateways) ? gateways : [] } });
});

/**
 * Hands a store to another owner. Within their store limit (users.maxstore), like an owner adding a shop themselves;
 * raise Max stores on the Owners tab first. The store's orders, drop offs and payouts go with it.
 */
admin.post('/stores/:id/owner', async (c) => {
  const id = Number(c.req.param('id'));
  const { owner_id } = await parseBody(c, z.object({ owner_id: z.number().int().positive() }));
  const db = c.env.DB;
  const store = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT owner_id FROM stores WHERE id = ?').bind(id).first<{ owner_id: number | null }>() : null;
  if (!store) fail(404, 'Store not found');
  if (store.owner_id === owner_id) return c.json({ owner_id });
  const owner = await db
    .prepare("SELECT name, maxstore, (SELECT COUNT(*) FROM stores WHERE owner_id = u.id) AS store_count FROM users u WHERE id = ? AND role = 'owner'")
    .bind(owner_id)
    .first<{ name: string; maxstore: number; store_count: number }>();
  if (!owner) fail(400, 'owner_id: not a shop owner');
  if (owner.store_count >= owner.maxstore) {
    fail(409, `${owner.name} already runs ${owner.store_count} of ${owner.maxstore} stores. Raise their Max stores on the Owners tab first.`);
  }
  await db.prepare('UPDATE stores SET owner_id = ? WHERE id = ?').bind(owner_id, id).run();
  console.log('[admin] store owner set', { by: c.get('user').id, store: id, from: store.owner_id, to: owner_id });
  return c.json({ owner_id });
});

/**
 * Moves a store's map pin. New bookings price their road distance from it; drop offs already booked keep the spot they
 * were given (transactions_dropoff.shop_lat/lng).
 */
admin.post('/stores/:id/location', async (c) => {
  const id = Number(c.req.param('id'));
  const { lat, lng } = await parseBody(c, z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }));
  const db = c.env.DB;
  const old = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT lat, lng FROM stores WHERE id = ?').bind(id).first<{ lat: number | null; lng: number | null }>() : null;
  if (!old) fail(404, 'Store not found');
  await db.prepare('UPDATE stores SET lat = ?, lng = ? WHERE id = ?').bind(lat, lng, id).run();
  console.log('[admin] store location set', { by: c.get('user').id, store: id, from: old, to: { lat, lng } });
  return c.json({ lat, lng });
});

/** Areas a store can move to: every group_id with a rate. */
admin.get('/groups', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT group_id FROM rates GROUP BY group_id ORDER BY group_id = 'default' DESC, group_id",
  ).all<{ group_id: string }>();
  return c.json({ groups: results.map((r) => r.group_id) });
});

/**
 * Moves a store to another area (group_id): it then uses that area's rates and its drop offs go to that area's drivers.
 * Only to an area with rates, and not while a drop off is in progress (its request lives in the old area's Dispatch).
 */
admin.post('/stores/:id/group', async (c) => {
  const id = Number(c.req.param('id'));
  const { group_id } = await parseBody(c, z.object({ group_id: rateSchema.shape.group_id }));
  const db = c.env.DB;
  const store = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT group_id FROM stores WHERE id = ?').bind(id).first<{ group_id: string }>() : null;
  if (!store) fail(404, 'Store not found');
  if (!(await db.prepare('SELECT 1 FROM rates WHERE group_id = ?').bind(group_id).first())) fail(400, `Area "${group_id}" has no rates yet. Add them on the Rates tab first.`);
  const busy = await db
    .prepare("SELECT 1 FROM transactions_dropoff WHERE store_id = ? AND status IN ('searching', 'driver_accepted', 'en_route_pickup', 'en_route_shop')")
    .bind(id)
    .first();
  if (busy) fail(409, 'This store has a drop off in progress. Try again once it reaches the shop.');
  await db.prepare('UPDATE stores SET group_id = ? WHERE id = ?').bind(group_id, id).run();
  console.log('[admin] store group set', { by: c.get('user').id, store: id, from: store.group_id, to: group_id });
  return c.json({ group_id });
});

export default admin;
