import type { Dispatch } from './do/dispatch';
import type { OrderRoom, PickupBoard } from './do/pickups';
import type { Trip } from './do/trip';

export type Role = 'customer' | 'driver' | 'owner';
export type StoreType = 'food' | 'laundry';
export type OrderType = 'pickup';
export type OrderStatus = 'awaiting_payment' | 'payment_confirmed' | 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export type Bindings = { DB: D1Database; JWT_SECRET: string; DELIVERY_FEE: string; PICKUP_ENABLED: string; OSRM_URL: string; OSRM_USER_AGENT: string; ORS_URL: string; ORS_API_KEY?: string; DISPATCH: DurableObjectNamespace<Dispatch>; TRIP: DurableObjectNamespace<Trip>; PICKUPS: DurableObjectNamespace<PickupBoard>; ORDER_ROOM: DurableObjectNamespace<OrderRoom>; PROOFS: R2Bucket };
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
export type OrderItem = { id: number; name: string; price: number; qty: number; image_url: string | null };

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
  /** What the customer pays for delivery: the driver's share plus service_fee. */
  delivery_fee: number;
  /** The app's cut of delivery_fee; 0 for flat-fee orders. */
  service_fee: number;
  created_at: string;
  updated_at: string;
  payment_ref: string;
  payment_photo_key: string | null;
  /** When the owner paid the driver their share of the delivery fee. */
  driver_paid_at: string | null;
  /** Map pins: the customer's pinned spot (null for typed addresses), the store's, and the driver's latest fix while picked up. */
  customer_lat: number | null;
  customer_lng: number | null;
  store_lat: number | null;
  store_lng: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_loc_at: string | null;
  store_name: string;
  store_logo: string | null;
  store_address: string;
  store_type: StoreType;
  customer_name: string;
  customer_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_has_face: boolean;
  driver_has_id: boolean;
  /** Changes when the driver retakes a photo; goes in the driver-photo URLs as `?v=`. */
  driver_photo_version: string;
  /** The driver's license plate. */
  driver_notes: string;
  driver_verified: boolean;
};
export type OrderDetail = OrderRow & { items: OrderItem[] };
