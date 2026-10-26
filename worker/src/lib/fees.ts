export type Rate = { base_fee: number; rate_per_km: number; commission_pct: number };

/** rates.type: pickups and drop offs are priced separately. */
export const RATE_TYPES = ['pickup', 'dropoff'] as const;
export type RateType = (typeof RATE_TYPES)[number];

/** app_fee.type: what an owner's payment to the app covers ('both' = service fee and subscription). */
export const APP_FEE_TYPES = ['both', 'service_fee', 'subscription'] as const;

/** rates.category: the vehicle a rate is for, by code. Add new codes here; the column has no CHECK. */
export const VEHICLE_CATEGORIES = { 1: 'Bicycle', 2: 'Motorcycle', 3: 'Tricycle', 4: 'Car (lightweight)' } as const;
export type VehicleCategory = keyof typeof VEHICLE_CATEGORIES;
export const isVehicleCategory = (n: number): n is VehicleCategory => n in VEHICLE_CATEGORIES;
/** Motorcycle: bookings use it until customers can pick a vehicle. */
export const DEFAULT_CATEGORY: VehicleCategory = 2;
/** SQL for a driver's vehicle code from driver_data `dd`: drivers who haven't picked one count as motorcycle. */
export const driverVehicleSql = (dd: string) => `COALESCE(${dd}.vehicle_type, ${DEFAULT_CATEGORY})`;

/** The vehicle a driver takes bookings for. */
export async function driverVehicle(db: D1Database, userId: number) {
  const row = await db.prepare(`SELECT ${driverVehicleSql('dd')} AS v FROM users u LEFT JOIN driver_data dd ON dd.user_id = u.id WHERE u.id = ?`).bind(userId).first<{ v: number }>();
  return row?.v ?? DEFAULT_CATEGORY;
}

/**
 * Every computed amount is rounded up to a whole peso (centavos always 00). Rounds to whole centavos first,
 * so float noise like 3.2 km × 1000 = 3200.0000000000005 doesn't add a peso.
 */
export const roundUpToPeso = (centavos: number) => Math.ceil(Math.round(centavos) / 100) * 100;

/** A menu price (centavos) after its percent discount, rounded up to a whole peso. */
export const discountedPrice = (price: number, discountPercent: number) => roundUpToPeso((price * (100 - discountPercent)) / 100);

/** All amounts in centavos. The customer only ever sees `total_delivery_fee`. */
export function computeFees(roadKm: number, rate: Rate) {
  const delivery_fee = roundUpToPeso(rate.base_fee + roadKm * rate.rate_per_km);
  const service_fee = roundUpToPeso((delivery_fee * rate.commission_pct) / 100);
  return { delivery_fee, service_fee, total_delivery_fee: delivery_fee + service_fee };
}
