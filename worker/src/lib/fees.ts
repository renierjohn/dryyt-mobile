export type Rate = { base_fee: number; rate_per_km: number; commission_pct: number };

/** A menu price (centavos) after its percent discount. */
export const discountedPrice = (price: number, discountPercent: number) => Math.round((price * (100 - discountPercent)) / 100);

/** All amounts in centavos. The customer only ever sees `total_delivery_fee`. */
export function computeFees(roadKm: number, rate: Rate) {
  const delivery_fee = rate.base_fee + Math.round(roadKm * rate.rate_per_km);
  const service_fee = Math.round((delivery_fee * rate.commission_pct) / 100);
  return { delivery_fee, service_fee, total_delivery_fee: delivery_fee + service_fee };
}
