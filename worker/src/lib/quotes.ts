import { sign, verify } from 'hono/jwt';

import type { Bindings, LatLng } from '../types';
import { computeFees, driverVehicleSql, isVehicleCategory, type Rate, type RateType } from './fees';
import { haversineKm, MAX_KM } from './geo';
import { fail } from './http';
import { roadDistanceKm } from './routing';

/** One vehicle's price for a trip. base_fee and rate_per_km are shown to the customer; the fee split is not. */
export type VehicleFee = { vehicle_type: number; base_fee: number; rate_per_km: number } & ReturnType<typeof computeFees>;
export type Quote = { road_km: number; options: VehicleFee[] };
type QuoteClaims = Quote & { kind: RateType; store_id: number; lat: number; lng: number; exp: number };

/** A quote stays good this long: the customer books at the prices they saw. */
const QUOTE_TTL_SECONDS = 15 * 60;
// Its own secret, so a quote token can never pass as a session token.
const quoteSecret = (env: Bindings) => `${env.JWT_SECRET}:quote`;

/** Every vehicle the area has a `kind` rate for, priced over `roadKm`, in vehicle code order. */
async function priceVehicles(db: D1Database, groupId: string, kind: RateType, roadKm: number): Promise<VehicleFee[]> {
  const { results } = await db
    .prepare('SELECT category, base_fee, rate_per_km, commission_pct FROM rates WHERE group_id = ? AND type = ? ORDER BY category')
    .bind(groupId, kind)
    .all<Rate & { category: number }>();
  return results
    .filter((r) => isVehicleCategory(r.category))
    .map((r) => ({ vehicle_type: r.category, base_fee: r.base_fee, rate_per_km: r.rate_per_km, ...computeFees(roadKm, r) }));
}

/** The road distance from `at` to the store and each vehicle's price for it. */
export async function quoteFor(env: Bindings, kind: RateType, store: { group_id: string } & LatLng, at: LatLng): Promise<Quote> {
  const roadKm = await roadDistanceKm(env, at, { lat: store.lat, lng: store.lng });
  const options = await priceVehicles(env.DB, store.group_id, kind, roadKm);
  if (options.length === 0) fail(500, 'No rates set for this area');
  return { road_km: roadKm, options };
}

export const signQuote = (env: Bindings, kind: RateType, storeId: number, at: LatLng, quote: Quote) =>
  sign(
    { ...quote, kind, store_id: storeId, lat: at.lat, lng: at.lng, exp: Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS } satisfies QuoteClaims,
    quoteSecret(env),
    'HS256',
  );

/**
 * The vehicles with at least one driver who would get this booking right now, by the same rules as the job lists:
 * verified, free and not blocked, and online for drop offs (in the store's area, last seen within MAX_KM of the pin or
 * never located, like Dispatch's push to idle drivers) or online for pickup. A hint only: drivers come and go.
 */
export async function availableVehicles(db: D1Database, kind: RateType, store: { id: number; group_id: string }, at: LatLng) {
  const where =
    kind === 'dropoff'
      ? `d.online = 1 AND d.group_id = ?1 AND NOT EXISTS (SELECT 1 FROM driver_blocks b WHERE b.store_id = ?2 AND b.driver_id = d.user_id)`
      : 'd.pickup_online = 1';
  const { results } = await db
    .prepare(
      `SELECT ${driverVehicleSql('dd')} AS vehicle_type, d.lat, d.lng FROM drivers d
       JOIN users u ON u.id = d.user_id JOIN driver_data dd ON dd.user_id = d.user_id
       WHERE ${where} AND d.busy = 0 AND dd.status = 1 AND u.blocked = 0`,
    )
    .bind(...(kind === 'dropoff' ? [store.group_id, store.id] : []))
    .all<{ vehicle_type: number; lat: number | null; lng: number | null }>();
  const near = (d: { lat: number | null; lng: number | null }) =>
    kind !== 'dropoff' || d.lat === null || d.lng === null || haversineKm({ lat: d.lat, lng: d.lng }, at) <= MAX_KM;
  return new Set(results.filter(near).map((d) => d.vehicle_type));
}

/** What the customer sees of a quote: no fee split, and whether each vehicle has a driver available. */
export const publicQuote = (quote: Quote, token: string, available: Set<number>) => ({
  road_km: quote.road_km,
  options: quote.options.map(({ vehicle_type, base_fee, rate_per_km, total_delivery_fee }) => ({
    vehicle_type,
    base_fee,
    rate_per_km,
    total_delivery_fee,
    available: available.has(vehicle_type),
  })),
  token,
});

/** The quote signed for this service, store and pin, or null (missing, expired, tampered, or for another pin). */
async function verifiedQuote(env: Bindings, token: string | undefined, kind: RateType, storeId: number, at: LatLng): Promise<Quote | null> {
  if (!token) return null;
  try {
    const q = (await verify(token, quoteSecret(env), 'HS256')) as unknown as QuoteClaims;
    if (q.kind !== kind || q.store_id !== storeId || q.lat !== at.lat || q.lng !== at.lng || !Array.isArray(q.options)) return null;
    return { road_km: q.road_km, options: q.options };
  } catch {
    return null;
  }
}

/** The chosen vehicle's fees: from the quote token when it is for this store and pin, else priced again. */
export async function feesFor(
  env: Bindings,
  kind: RateType,
  store: { id: number; group_id: string } & LatLng,
  at: LatLng,
  vehicleType: number,
  token: string | undefined,
) {
  const quote = (await verifiedQuote(env, token, kind, store.id, at)) ?? (await quoteFor(env, kind, store, at));
  const chosen = quote.options.find((o) => o.vehicle_type === vehicleType);
  if (!chosen) fail(400, 'vehicle_type: this area has no rate for that vehicle');
  const { delivery_fee, service_fee, total_delivery_fee } = chosen;
  return { road_km: quote.road_km, delivery_fee, service_fee, total_delivery_fee };
}
