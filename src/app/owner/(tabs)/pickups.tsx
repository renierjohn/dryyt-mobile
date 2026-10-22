import { OwnerOrders } from '@/components/owner-orders';

/** Laundry pickups: set the laundry fee, check the payment. */
export default function Pickups() {
  return <OwnerOrders type="laundry" title="Laundry pickups" />;
}
