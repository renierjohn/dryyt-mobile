import type { Dispatch } from './do/dispatch';
import type { Trip } from './do/trip';

export type Role = 'customer' | 'driver' | 'owner';
export type StoreType = 'food' | 'laundry';
export type OrderType = 'pickup';
export type OrderStatus = 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export type Bindings = { DB: D1Database; JWT_SECRET: string; DELIVERY_FEE: string; PICKUP_ENABLED: string; OSRM_URL: string; OSRM_USER_AGENT: string; ORS_URL: string; ORS_API_KEY?: string; DISPATCH: DurableObjectNamespace<Dispatch>; TRIP: DurableObjectNamespace<Trip>; PROOFS: R2Bucket };
export type AuthUser = { id: number; role: Role };
export type AppEnv = { Bindings: Bindings; Variables: { user: AuthUser } };

export type User = { id: number; email: string; name: string; phone: string; role: Role };
export type Store = {
  id: number;
  name: string;
  type: StoreType;
  address: string;
  owner_id: number | null;
  group_id: string;
  lat: number | null;
  lng: number | null;
  store_logo: string | null;
  store_payment_gateway: PaymentGateway[];
};

/** A payment QR the shop accepts, e.g. "GCash 0917 123 4567". */
export type PaymentGateway = { label: string; image_url: string };

export type LatLng = { lat: number; lng: number };

export type DropoffStatus =
  | 'searching'
  | 'driver_accepted'
  | 'en_route_pickup'
  | 'en_route_shop'
  | 'dropped_off'
  | 'owner_confirmed'
  | 'completed'
  | 'payment_pending'
  | 'cancelled'
  | 'expired';
export type MenuItem = {
  id: number;
  name: string;
  price: number;
  image_url: string | null;
  discount_percent: number;
  category: string;
  best_seller: boolean;
  /** Units delivered; maintained by the worker, never set by owners. */
  popularity: number;
};

/** A menu item on the customers' popular list, with the store it comes from. */
export type PopularItem = MenuItem & { store_id: number; store_name: string; store_logo: string | null };
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
  customer_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
};
export type OrderDetail = OrderRow & { items: OrderItem[] };
