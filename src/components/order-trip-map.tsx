import { DropoffMap, PinColor, type MapPin } from '@/components/dropoff-map';
import type { LatLng, Order } from '@/lib/types';

const pinOf = (lat: number | null, lng: number | null): LatLng | null => (lat !== null && lng !== null ? { lat, lng } : null);

/**
 * A picked-up pickup order on the map: the driver, the store and the customer. `driverAt` is the driver's own
 * phone fix (driver view); otherwise the last location the driver sent (customer view). Missing pins are left out.
 */
export function OrderTripMap({ order, driverAt }: { order: Order; driverAt?: LatLng | null }) {
  const driver = driverAt ?? pinOf(order.driver_lat, order.driver_lng);
  const store = pinOf(order.store_lat, order.store_lng);
  const customer = pinOf(order.customer_lat, order.customer_lng);
  const pins: MapPin[] = [
    ...(customer ? [{ key: 'customer', at: customer, title: order.customer_name, color: PinColor.customer, icon: 'person' as const }] : []),
    ...(store ? [{ key: 'store', at: store, title: order.store_name, color: PinColor.shop, icon: 'store' as const }] : []),
    ...(driver ? [{ key: 'driver', at: driver, title: order.driver_name ?? 'Driver', color: PinColor.driver, icon: 'motorcycle' as const }] : []),
  ];
  const center = driver ?? customer ?? store;
  return center ? <DropoffMap center={center} pins={pins} /> : null;
}
