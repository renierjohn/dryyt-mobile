import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { DriverDetails } from '@/components/driver-details';
import { JobChat, useJobChat } from '@/components/job-chat';
import { LaundryPayment } from '@/components/payment-method';
import { PaymentWait } from '@/components/payment-wait';
import { OrderPaymentProof } from '@/components/order-payment-proof';
import { OrderSummary } from '@/components/order-summary';
import { OrderTripMap } from '@/components/order-trip-map';
import { Screen } from '@/components/screen';
import { StatusBadge, type Tone } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCancelOrder, useOrder, usePlaceOrder } from '@/hooks/queries';
import { useCart } from '@/hooks/use-cart';
import { useSocket } from '@/hooks/use-socket';
import { peso, STATUS_LABEL } from '@/lib/format';
import type { LatLng, OrderStatus } from '@/lib/types';

const CANCELLABLE: OrderStatus[] = ['awaiting_fee', 'to_pay', 'awaiting_payment', 'payment_confirmed', 'pending'];
/** After the customer sent their payment to the shop: cancelling doesn't give it back. */
const PAID: OrderStatus[] = ['awaiting_payment', 'payment_confirmed', 'pending'];
const LIVE_STATUSES: OrderStatus[] = ['awaiting_fee', 'to_pay', 'awaiting_payment', 'payment_confirmed', 'pending', 'accepted', 'picked_up'];

export default function OrderScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const qc = useQueryClient();
  const live = useRef(false);
  const order = useOrder(id, () => live.current);
  const [driverAt, setDriverAt] = useState<LatLng | null>(null);
  // Live from Send to shop (laundry) or Send proof of payment (food) until delivered (or cancelled): the worker pushes each change and the driver's location.
  const status = order.data?.status;
  const chat = useJobChat();
  const { connected, send } = useSocket(status && LIVE_STATUSES.includes(status) ? `order-${id}` : null, (msg) => {
    if (chat.onMessage(msg)) return;
    if (msg.t === 'order') qc.setQueryData(['order', id], msg.order);
    else if (msg.t === 'loc') setDriverAt({ lat: msg.lat, lng: msg.lng });
  });
  useEffect(() => {
    live.current = connected;
  });
  const cancel = useCancelOrder(id);
  const place = usePlaceOrder();
  const cart = useCart();

  if (order.isPending) {
    return (
      <Screen edges={[]}>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (order.isError) {
    return (
      <Screen edges={[]}>
        <ErrorText error={order.error} />
      </Screen>
    );
  }

  const o = order.data;
  const tone: Tone = o.status === 'delivered' ? 'success' : o.status === 'cancelled' ? 'danger' : 'info';
  return (
    <Screen edges={[]} onRefresh={order.refetch}>
      <Card>
        <View style={styles.statusRow}>
          <ThemedText type="smallBold" style={styles.grow}>
            Order #{o.id}
          </ThemedText>
          <StatusBadge label={STATUS_LABEL[o.status]} tone={tone} />
        </View>
        <StatusTimeline status={o.status} paid={o.store_type === 'food'} laundry={o.store_type === 'laundry'} />
      </Card>
      {/* The driver has the order: follow them to you, live over the order's socket. */}
      {o.status === 'picked_up' && <OrderTripMap order={o} driverAt={driverAt} />}
      <Card>
        <OrderSummary order={o} />
      </Card>
      {/* While the driver is coming: who to expect (face, license, plate, badge). */}
      {(o.status === 'accepted' || o.status === 'picked_up') && o.driver_name ? (
        <Card>
          <DriverDetails driver={o} photoPath={`/orders/${o.id}/driver-photo`} />
        </Card>
      ) : o.driver_name ? (
        <Card>
          <View style={styles.statusRow}>
            <Avatar name={o.driver_name} />
            <View style={styles.grow}>
              <ThemedText type="smallBold">{o.driver_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {o.driver_phone}
              </ThemedText>
            </View>
          </View>
        </Card>
      ) : null}
      <OrderPaymentProof order={o} />
      {/* Until pickup: the chat is for meeting up, and the room wipes it once the driver has the order. */}
      {o.status === 'accepted' && <JobChat chat={chat} me="customer" otherName={o.driver_name} send={send} connected={connected} />}
      {o.status === 'awaiting_fee' && (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <ThemedText style={styles.grow}>Waiting for {o.store_name} to set the laundry fee…</ThemedText>
        </View>
      )}
      {o.status === 'to_pay' && <LaundryPayment order={o} />}
      {o.status === 'awaiting_payment' && o.store_type === 'laundry' && <PaymentWait since={o.updated_at} />}
      <ErrorText error={cancel.error ?? place.error} />
      {(o.status === 'awaiting_payment' || o.status === 'payment_confirmed') && (
        <Button
          title="Place order"
          disabled={o.status !== 'payment_confirmed'}
          loading={place.isPending}
          // The cart was waiting on this order; it's done once placed.
          onPress={() => place.mutate(id, { onSuccess: () => cart.orderId === id && cart.clear() })}
        />
      )}
      {CANCELLABLE.includes(o.status) && (
        <Button
          title="Cancel order"
          variant="danger"
          loading={cancel.isPending}
          onPress={() =>
            PAID.includes(o.status)
              ? Alert.alert(
                  'Cancel a paid order?',
                  `You already paid ${peso(o.items_total + o.total_delivery_fee)} to ${o.store_name}. Cancelling won't refund it automatically: contact the shop for your refund.`,
                  [
                    { text: 'Keep order', style: 'cancel' },
                    { text: 'Cancel order', style: 'destructive', onPress: () => cancel.mutate() },
                  ],
                )
              : cancel.mutate()
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
});
