import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DishPhoto } from '@/components/dish-photo';
import { DeliveryPinCard, useDeliveryPin } from '@/components/delivery-pin';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { PaymentMethod, type PaymentProof } from '@/components/payment-method';
import { PaymentWait } from '@/components/payment-wait';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useOrder, usePlaceOrder } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { useCart } from '@/hooks/use-cart';
import { useSocket } from '@/hooks/use-socket';
import { discountedPrice, peso } from '@/lib/format';
import type { LatLng } from '@/lib/types';

export default function CartScreen() {
  const cart = useCart();
  const signedIn = useAuth().state.status === 'signedIn';

  if (!signedIn && cart.store) return <SignInFirst />;
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

/**
 * A guest's cart: opens Sign in on top of it once. Signing in closes Sign in and lands back here, now as the checkout;
 * a guest who backs out gets a button to try again. The cart is kept either way.
 */
function SignInFirst() {
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    router.push('/sign-in');
  }, []);
  return (
    <Screen edges={[]}>
      <ThemedText themeColor="textSecondary">Sign in to continue with your order.</ThemedText>
      <Button title="Sign in" onPress={() => router.push('/sign-in')} />
    </Screen>
  );
}

type CartStore = { id: number; name: string };

/**
 * The delivery pin and payment for the cart. It doesn't read the cart itself: the lines, the footer total and the
 * payment do, so + and − re-render those and leave the map alone. memo: CartScreen re-renders on every cart change.
 */
const Checkout = memo(function Checkout({ store }: { store: CartStore }) {
  const pin = useDeliveryPin(store.id);
  const { at, fee, vehicle, quote } = pin;

  return (
    <Screen edges={[]} footer={<CheckoutTotal fee={fee} />}>
      <CartLines store={store} />
      <DeliveryPinCard storeName={store.name} pin={pin} />
      {fee !== null && at && <CartPayment store={store} at={at} fee={fee} vehicle={vehicle} quoteToken={quote.data?.token} />}
    </Screen>
  );
});

function CheckoutTotal({ fee }: { fee: number | null }) {
  const cart = useCart();
  return (
    <>
      <ThemedText type="smallBold">
        {fee === null ? `Items ${peso(cart.itemsTotal)} + delivery fee` : `Total ${peso(cart.itemsTotal + fee)}`}
      </ThemedText>
      {/* Enabled once the store confirms the payment (see AwaitingPayment). */}
      <Button title="Place order" onPress={() => {}} disabled />
    </>
  );
}

function CartLines({ store }: { store: CartStore }) {
  const cart = useCart();
  return (
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
  );
}

/** Pay the store for the items plus `fee`, delivering to `at`; sending the proof creates the order. */
function CartPayment({
  store,
  at,
  fee,
  vehicle,
  quoteToken,
}: {
  store: CartStore;
  at: LatLng;
  fee: number;
  vehicle: number | null;
  quoteToken: string | undefined;
}) {
  const cart = useCart();
  const createOrder = useCreateOrder();
  const sendProof = (proof: PaymentProof) =>
    createOrder.mutate(
      {
        type: 'pickup',
        store_id: store.id,
        items: cart.lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })),
        lat: at.lat,
        lng: at.lng,
        ...proof,
        vehicle_type: vehicle ?? undefined,
        quote_token: quoteToken,
      },
      { onSuccess: (order) => cart.setOrderId(order.id) },
    );
  return (
    <PaymentMethod
      storeId={store.id}
      storeName={store.name}
      total={cart.itemsTotal + fee}
      onSend={sendProof}
      sending={createOrder.isPending}
      error={createOrder.error}
    />
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
      {status === 'awaiting_payment' && <PaymentWait since={order.data!.updated_at} />}
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
