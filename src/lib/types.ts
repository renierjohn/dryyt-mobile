// Mirrors worker/src/types.ts
export type Role = 'customer' | 'driver' | 'owner';
export type StoreType = 'food' | 'laundry';
export type OrderType = 'pickup';
export type OrderStatus = 'awaiting_fee' | 'to_pay' | 'awaiting_payment' | 'payment_confirmed' | 'pending' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export type User = { id: number; email: string; name: string; phone: string; role: Role };
export type Store = {
  id: number;
  name: string;
  type: StoreType;
  address: string;
  lat: number | null;
  lng: number | null;
  store_logo: string | null;
  /** Up to 3. */
  store_payment_gateway: PaymentGateway[];
};
/** A payment QR the shop accepts, e.g. "GCash 0917 123 4567". */
export type PaymentGateway = { label: string; image_url: string };
export type MenuItem = {
  id: number;
  name: string;
  /** Centavos, before `discount_percent`. */
  price: number;
  image_url: string | null;
  discount_percent: number;
  category: string;
  best_seller: boolean;
  /** Units delivered; set by the worker. */
  popularity: number;
};
export type StoreWithMenu = Store & { menu: MenuItem[] };
/** A menu item on the popular list, with its store. */
export type PopularItem = MenuItem & { store_id: number; store_name: string; store_logo: string | null };
export type OrderItem = { id: number; name: string; price: number; qty: number; image_url: string | null };

export type Order = {
  id: number;
  type: OrderType;
  customer_id: number;
  driver_id: number | null;
  store_id: number;
  status: OrderStatus;
  customer_address: string;
  notes: string;
  items_total: number;
  /** The driver's share of total_delivery_fee. */
  delivery_fee: number;
  /** The app's cut; 0 for flat-fee orders. */
  service_fee: number;
  /** What the customer pays for delivery: delivery_fee plus service_fee. */
  total_delivery_fee: number;
  /** The vehicle the customer booked (see lib/vehicles). */
  vehicle_type: number;
  /** Road distance customer to store; null for typed-address (flat-fee) orders. */
  road_km: number | null;
  created_at: string;
  updated_at: string;
  /** Proof of an upfront (food) payment: a reference number and/or a photo (see /owner/orders/:id/payment-photo). */
  payment_ref: string;
  payment_photo_key: string | null;
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
  /** The assigned driver's verification (face/license photos via /orders/:id/driver-photo/face|id). */
  driver_has_face: boolean;
  driver_has_id: boolean;
  /** Changes when the driver retakes a photo; goes in the driver-photo URLs as `?v=`. */
  driver_photo_version: string;
  /** The driver's license plate. */
  driver_notes: string;
  driver_verified: boolean;
};
export type OrderDetail = Order & { items: OrderItem[] };

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

/** Mirrors worker viewFor(): delivery_fee/service_fee only for drivers and owners; room_id not for owners. */
export type Dropoff = {
  id: number;
  room_id?: string;
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
  delivery_fee?: number;
  service_fee?: number;
  total_delivery_fee: number;
  /** The vehicle the customer booked (see lib/vehicles). */
  vehicle_type: number;
  laundry_fee: number | null;
  created_at: string;
  updated_at: string;
  store_name: string;
  store_logo: string | null;
  store_address: string;
  customer_name: string;
  customer_phone: string;
  driver_name: string | null;
  driver_phone: string | null;
  /** The assigned driver's verification: photos (fetch via /dropoffs/:id/driver-photo/face|id), license plate, badge. */
  driver_has_face: boolean;
  driver_has_id: boolean;
  /** Changes when the driver retakes a photo; goes in the driver-photo URLs as `?v=`. */
  driver_photo_version: string;
  driver_notes: string;
  driver_verified: boolean;
  weight_kg: number | null;
  drop_notes: string | null;
  owner_status: 'pending' | 'ok' | null;
  has_proof: boolean;
  /** The customer's proof of payment: a reference number and/or a photo (fetch via /dropoffs/:id/payment-photo). */
  payment_ref: string;
  has_payment_photo: boolean;
};

export type DistanceColour = 'green' | 'amber';

export type DispatchRequest = {
  transaction_id: number;
  store_name: string;
  address: string;
  customer_name: string;
  customer_phone: string;
  lat: number;
  lng: number;
  shop_lat: number;
  shop_lng: number;
  distance_km: number;
  colour: DistanceColour;
  delivery_fee: number;
  total_delivery_fee: number;
};

export type NearbyDriver = { lat: number; lng: number; colour: DistanceColour };

/** `online`: for drop offs; `pickup_online`: for pickup jobs; `pickup_job_id`: the pickup order they're on, if any. */
export type DriverMe = {
  /** `verified`: the driver has the verified badge; without it they can't go online or accept jobs. */
  driver: { online: boolean; busy: boolean; pickup_online: boolean; pickup_job_id: number | null; verified: boolean };
  job: Dropoff | null;
};

/** `verified` is set by a developer only. */
export type DriverVerification = {
  has_face: boolean;
  has_id: boolean;
  /** Changes when a photo is retaken; goes in the photo URLs as `?v=`. */
  photo_version: string;
  /** How the face photo was taken; 'skipped' waits for a closer manual review. null: no face photo, or an older one. */
  face_check: 'passed' | 'skipped' | null;
  notes: string;
  /** Vehicle code (src/lib/vehicles.ts); null until picked. */
  vehicle_type: number | null;
  verified: boolean;
};

export type Payout = {
  id: number;
  transaction_id: number;
  payee_type: 'driver' | 'developer';
  payee_id: number | null;
  payee_name: string | null;
  store_name: string | null;
  amount: number;
  status: 'pending' | 'paid';
  paid_at: string | null;
  created_at: string;
  /** The drop off's driver, also on the app's service fee lines (whose payee is the app). */
  driver_name: string | null;
  /** The driver's face photo, from GET /owner/drivers/:payee_id/face?v=<payee_photo_version>. */
  payee_has_face: boolean;
  payee_photo_version: string;
};

/** A delivered pickup's driver share of the delivery fee; `id` is the order id. */
export type PickupPayout = {
  id: number;
  store_id: number;
  store_name: string;
  driver_id: number;
  driver_name: string | null;
  amount: number;
  paid_at: string | null;
  updated_at: string;
  /** The driver's face photo, from GET /owner/drivers/:driver_id/face?v=<driver_photo_version>. */
  driver_has_face: boolean;
  driver_photo_version: string;
};

/** GET /owner/app-fee: this month's app fee due per shop and the owner's latest subscription payment. */
export type OwnerAppFee = {
  /** "YYYY-MM", Manila. */
  month: string;
  stores: {
    id: number;
    name: string;
    type: StoreType;
    store_logo: string | null;
    /** 1 flat fee, 2 percentage of sales. */
    fee_type: 1 | 2;
    fee_flat: number;
    fee_percentage: number;
    sales: number;
    amount_due: number;
  }[];
  /** The latest payment, from any month. */
  last_payment: OwnerAppFeePayment | null;
  /** Every payment dated this month, newest first. */
  payments: OwnerAppFeePayment[];
};

/** An owner's payment to the app (app_fee row). Dates are YYYY-MM-DD. */
export type OwnerAppFeePayment = {
  id: number;
  /** 0 and type null: a proof the owner sent, waiting for the cpanel to fill in the payment. */
  amount: number;
  type: 'both' | 'service_fee' | 'subscription' | null;
  payment_type: string;
  date_paid: string;
  next_due_date: string | null;
  ref_number: string;
  has_photo: boolean;
};

/** One delivery's service fee for the app (the APP Fee tab): a delivered pickup or a completed drop off. */
export type ServiceFee = { kind: 'pickup' | 'dropoff'; id: number; amount: number; at: string; driver_name: string | null };
