import { OwnerOrders } from '@/components/owner-orders';

/** Food orders; laundry pickups have their own tab. */
export default function Orders() {
  return <OwnerOrders type="food" title="Orders" />;
}
