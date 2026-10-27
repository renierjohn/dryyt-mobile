import type { NewRequest } from '../do/dispatch';
import type { AuthUser, Bindings } from '../types';
import type { DropoffRow } from './dropoffs';
import { driverVehicleSql } from './fees';
import { verifiedDriverSql } from './verified';

/** Which Dispatch group (and, for customers, which drop off; for drivers, their vehicle) the user may join. */
export async function dispatchAccess(
  db: D1Database,
  user: AuthUser,
): Promise<{ group: string; transactionId?: number; vehicleType?: number } | null> {
  if (user.role === 'driver') {
    const d = await db
      .prepare(`SELECT d.group_id, ${driverVehicleSql('dd')} AS vehicle_type FROM drivers d LEFT JOIN driver_data dd ON dd.user_id = d.user_id WHERE d.user_id = ? AND d.online = 1 AND ${verifiedDriverSql('d.user_id')}`)
      .bind(user.id)
      .first<{ group_id: string; vehicle_type: number }>();
    return d ? { group: d.group_id, vehicleType: d.vehicle_type } : null;
  }
  if (user.role === 'customer') {
    const t = await db
      .prepare(
        `SELECT t.id, s.group_id FROM transactions_dropoff t JOIN stores s ON s.id = t.store_id
         WHERE t.customer_id = ? AND t.status IN ('searching', 'driver_accepted')`,
      )
      .bind(user.id)
      .first<{ id: number; group_id: string }>();
    return t ? { group: t.group_id, transactionId: t.id } : null;
  }
  return null;
}

/** Only the drop off's customer and assigned driver may join its trip room, and only while en route. */
export async function tripAccess(db: D1Database, user: AuthUser, roomId: string): Promise<{ transactionId: number } | null> {
  const column = user.role === 'customer' ? 'customer_id' : user.role === 'driver' ? 'driver_id' : null;
  if (!column) return null;
  const t = await db
    .prepare(`SELECT id FROM transactions_dropoff WHERE room_id = ? AND ${column} = ? AND status IN ('en_route_pickup', 'en_route_shop')`)
    .bind(roomId, user.id)
    .first<{ id: number }>();
  return t ? { transactionId: t.id } : null;
}

export const dispatchFor = (env: Bindings, group: string) => env.DISPATCH.get(env.DISPATCH.idFromName(group));
export const tripFor = (env: Bindings, roomId: string) => env.TRIP.get(env.TRIP.idFromName(roomId));

export async function blockedDrivers(db: D1Database, storeId: number) {
  const { results } = await db.prepare('SELECT driver_id FROM driver_blocks WHERE store_id = ?').bind(storeId).all<{ driver_id: number }>();
  return results.map((r) => r.driver_id);
}

export function newRequestFrom(row: DropoffRow, blocked: number[]): NewRequest {
  return {
    id: row.id,
    group: row.store_group_id,
    customerId: row.customer_id,
    storeName: row.store_name,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    address: row.customer_address,
    customer: { lat: row.customer_lat, lng: row.customer_lng },
    shop: { lat: row.shop_lat, lng: row.shop_lng },
    deliveryFee: row.delivery_fee,
    totalDeliveryFee: row.total_delivery_fee,
    vehicleType: row.vehicle_type,
    blocked,
  };
}
