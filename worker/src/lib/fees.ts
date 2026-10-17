export type Rate = { base_fee: number; rate_per_km: number; commission_pct: number };

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
