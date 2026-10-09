import type { AuthUser, DropoffStatus } from '../types';

export type DropoffRow = {
  id: number;
  room_id: string;
  customer_id: number;
  driver_id: number | null;
  store_id: number;
  status: DropoffStatus;
  customer_lat: number;
  customer_lng: number;
  customer_address: string;
  shop_lat: number;
  shop_lng: number;
  road_km: number;
  delivery_fee: number;
  service_fee: number;
  total_delivery_fee: number;
  laundry_fee: number | null;
  created_at: string;
  updated_at: string;
  store_name: string;
  store_address: string;
  store_owner_id: number | null;
  store_group_id: string;
  customer_name: string;
  customer_phone: string;
  driver_name: string | null;
  driver_phone: string | null;
  weight_kg: number | null;
  drop_notes: string | null;
  proof_photo_key: string | null;
  driver_photo_face: string | null;
  driver_photo_id: string | null;
  driver_notes: string | null;
  driver_status: number | null;
  owner_status: 'pending' | 'ok' | null;
};

const SELECT = `SELECT t.*,
    s.name AS store_name, s.address AS store_address, s.owner_id AS store_owner_id, s.group_id AS store_group_id,
    cu.name AS customer_name, cu.phone AS customer_phone,
    d.name AS driver_name, d.phone AS driver_phone,
    dd.photo_face AS driver_photo_face, dd.photo_id AS driver_photo_id, dd.notes AS driver_notes, dd.status AS driver_status,
    ot.weight_kg, ot.notes AS drop_notes, ot.proof_photo_key, ot.status AS owner_status
  FROM transactions t
  JOIN stores s ON s.id = t.store_id
  JOIN users cu ON cu.id = t.customer_id
  LEFT JOIN users d ON d.id = t.driver_id
  LEFT JOIN driver_data dd ON dd.user_id = t.driver_id
  LEFT JOIN owner_transactions ot ON ot.transaction_id = t.id`;

export async function listDropoffs(db: D1Database, where: string, ...binds: unknown[]) {
  const { results } = await db.prepare(`${SELECT} WHERE ${where}`).bind(...binds).all<DropoffRow>();
  return results;
}

export async function getDropoff(db: D1Database, id: number) {
  return (await listDropoffs(db, 't.id = ?', id))[0] ?? null;
}

/** What `user` may see of a drop off, or null when they have no access. Customers never see the fee split. */
export function viewFor(row: DropoffRow, user: AuthUser) {
  const { proof_photo_key, store_owner_id, store_group_id, delivery_fee, service_fee, room_id, ...rest } = row;
  const { driver_photo_face, driver_photo_id, driver_notes, driver_status, ...base } = rest;
  const shared = {
    ...base,
    has_proof: proof_photo_key !== null,
    // The assigned driver's verification, so the customer can check who is coming. Photo keys stay server-side.
    driver_has_face: driver_photo_face !== null,
    driver_has_id: driver_photo_id !== null,
    driver_notes: driver_notes ?? '',
    driver_verified: driver_status === 1,
  };
  if (user.role === 'customer' && row.customer_id === user.id) return { ...shared, room_id };
  if (user.role === 'driver' && row.driver_id === user.id) return { ...shared, room_id, delivery_fee, service_fee };
  if (user.role === 'owner' && store_owner_id === user.id) return { ...shared, delivery_fee, service_fee };
  return null;
}

export type DropoffView = NonNullable<ReturnType<typeof viewFor>>;
