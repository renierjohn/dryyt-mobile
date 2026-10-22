import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DishPhoto } from '@/components/dish-photo';
import { DeliveryPinCard, useDeliveryPin } from '@/components/delivery-pin';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { PaymentMethod, type PaymentProof } from '@/components/payment-method';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useOrder, usePlaceOrder } from '@/hooks/queries';
import { useCart } from '@/hooks/use-cart';
import { useSocket } from '@/hooks/use-socket';
import { discountedPrice, peso } from '@/lib/format';

export default function CartScreen() {
  const cart = useCart();

  if (!cart.store) {
    return (
      <Screen edges={[]}>
        <ThemedText themeColor="textSecondary">Your cart is empty.</ThemedText>
        <Button title="Browse popular" variant="secondary" onPress={() => router.replace('/customer/popular')} />
      </Screen>
    );
  }
  // Proof sent: wait here for the owner's Done Pay, then place the order.
  if (cart.orderId !== null) return <AwaitingPayment orderId={cart.orderId} />;
  return <Checkout store={cart.store} />;
}

function Checkout({ store }: { store: { id: number; name: string } }) {
  const cart = useCart();
  const createOrder = useCreateOrder();
  const pin = useDeliveryPin(store.id);
  const { at, fee, quote } = pin;

  const sendProof = (proof: PaymentProof) =>
    at &&
    createOrder.mutate(
      {
        type: 'pickup',
        store_id: store.id,
        items: cart.lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })),
        lat: at.lat,
        lng: at.lng,
        ...proof,
        quote_token: quote.data?.token,
      },
      { onSuccess: (order) => cart.setOrderId(order.id) },
    );

  return (
    <Screen
      edges={[]}
      footer={
        <>
          <ThemedText type="smallBold">
            {fee === null ? `Items ${peso(cart.itemsTotal)} + delivery fee` : `Total ${peso(cart.itemsTotal + fee)}`}
          </ThemedText>
          {/* Enabled once the store confirms the payment (see AwaitingPayment). */}
          <Button title="Place order" onPress={() => {}} disabled />
        </>
      }>
      <Card>
        <ThemedText type="smallBold">{store.name}</ThemedText>
        {cart.lines.map(({ item, qty }) => (
          <View key={item.id} style={styles.row}>
            <DishPhoto uri={item.image_url} size={48} testID={`cart-line-photo-${item.id}`} />
            <View style={styles.grow}>
              <ThemedText type="small">{item.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {peso(discountedPrice(item) * qty)}
              </ThemedText>
            </View>
            <Stepper value={qty} onChange={(delta) => cart.setQty(item.id, qty + delta)} />
          </View>
        ))}
        <Pressable onPress={() => router.push({ pathname: '/customer/new-order', params: { storeId: String(store.id) } })}>
          <ThemedText type="linkPrimary">Add more from {store.name}</ThemedText>
        </Pressable>
      </Card>
      <DeliveryPinCard storeName={store.name} pin={pin} />
      {fee !== null && (
        <PaymentMethod
          storeId={store.id}
          storeName={store.name}
          total={cart.itemsTotal + fee}
          onSend={sendProof}
          sending={createOrder.isPending}
          error={createOrder.error}
        />
      )}
    </Screen>
  );
}

/**
 * After the proof is sent: waits on the order's socket for Done Pay (by the store, or automatically after 10 min),
 * then Place order sends it to drivers. Polls only as a fallback.
 */
function AwaitingPayment({ orderId }: { orderId: number }) {
  const cart = useCart();
  const qc = useQueryClient();
  const live = useRef(false);
  const order = useOrder(orderId, () => live.current);
  const place = usePlaceOrder();
  const status = order.data?.status;
  const { connected } = useSocket(status === 'awaiting_payment' || status === 'payment_confirmed' ? `order-${orderId}` : null, (msg) => {
    if (msg.t === 'order') qc.setQueryData(['order', orderId], msg.order);
  });
  useEffect(() => {
    live.current = connected;
  });
  const done = () => {
    cart.clear();
    router.replace({ pathname: '/customer/order/[id]', params: { id: String(orderId) } });
  };

  return (
    <Screen
      edges={[]}
      onRefresh={order.refetch}
      footer={
        <>
          <ErrorText error={place.error} />
          {status === 'cancelled' ? (
            <Button title="Start over" variant="secondary" onPress={() => cart.setOrderId(null)} />
          ) : (
            <Button title="Place order" onPress={() => place.mutate(orderId, { onSuccess: done })} loading={place.isPending} disabled={status !== 'payment_confirmed'} />
          )}
        </>
      }>
      {order.isPending && <ActivityIndicator />}
      <ErrorText error={order.error} />
      {status === 'awaiting_payment' && (
        <View style={styles.row}>
          <ActivityIndicator />
          <ThemedText style={styles.grow}>Waiting for the store to confirm your payment…</ThemedText>
        </View>
      )}
      {status === 'payment_confirmed' && <ThemedText type="smallBold">Payment confirmed. Place your order to find a driver.</ThemedText>}
      {status === 'cancelled' && <ThemedText themeColor="textSecondary">This order was cancelled.</ThemedText>}
      {order.data && (
        <Card>
          <OrderSummary order={order.data} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
