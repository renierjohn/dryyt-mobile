import type { Context } from 'hono';

import type { AppEnv, AuthUser, Bindings } from '../types';
import { verifiedDriverSql } from './verified';

export const pickupBoard = (env: Bindings) => env.PICKUPS.get(env.PICKUPS.idFromName('all'));
export const orderRoom = (env: Bindings, orderId: number) => env.ORDER_ROOM.get(env.ORDER_ROOM.idFromName(`order-${orderId}`));

/** After D1 has committed: tell the board and the order's room. A failure is logged, never a 500 for a done action. */
export function pickupChanged(c: Context<AppEnv>, orderId: number, { board = true, room = true } = {}) {
  const work = async () => {
    await Promise.all([board && pickupBoard(c.env).refresh(), room && orderRoom(c.env, orderId).update(orderId)]);
  };
  c.executionCtx.waitUntil(work().catch((err) => console.error('pickup live update failed', err)));
}

/** Verified drivers online for pickup may join the job board. */
export async function boardAccess(db: D1Database, user: AuthUser) {
  if (user.role !== 'driver') return false;
  return Boolean(
    await db.prepare(`SELECT 1 FROM drivers WHERE user_id = ? AND pickup_online = 1 AND ${verifiedDriverSql('drivers.user_id')}`).bind(user.id).first(),
  );
}

/** The order's customer from placing it (laundry) or Send proof of payment (food) until delivered; its driver while they have it. */
export async function orderAccess(db: D1Database, user: AuthUser, orderId: number) {
  const where =
    user.role === 'customer'
      ? "customer_id = ? AND status IN ('awaiting_fee', 'to_pay', 'awaiting_payment', 'payment_confirmed', 'pending', 'accepted', 'picked_up')"
      : user.role === 'driver'
        ? "driver_id = ? AND status IN ('accepted', 'picked_up')"
        : null;
  if (!where) return false;
  return Boolean(await db.prepare(`SELECT 1 FROM transactions_pickup WHERE id = ? AND ${where}`).bind(orderId, user.id).first());
}

/** "order-12" → 12, else null. */
export function orderIdOf(room: string) {
  const m = /^order-(\d+)$/.exec(room);
  return m ? Number(m[1]) : null;
}
