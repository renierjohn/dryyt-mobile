import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DishPhoto } from '@/components/dish-photo';
import { DropoffMap, PinColor } from '@/components/dropoff-map';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useOrder, useOrderQuote, usePlaceOrder, useRoadRoute, useStore, useUploadPaymentPhoto } from '@/hooks/queries';
import { useCart } from '@/hooks/use-cart';
import { useCurrentLocation } from '@/hooks/use-location';
import { useSocket } from '@/hooks/use-socket';
import { discountedPrice, peso } from '@/lib/format';
import type { LatLng } from '@/lib/types';

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
  const upload = useUploadPaymentPhoto();
  const quote = useOrderQuote();
  const details = useStore(store.id);
  const here = useCurrentLocation();
  const [pin, setPin] = useState<LatLng | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [proof, setProof] = useState<{ uri: string; key: string } | null>(null);

  const shop = details.data?.lat != null && details.data.lng != null ? { lat: details.data.lat, lng: details.data.lng } : null;
  // Once Compute Delivery Fee is pressed the pin is locked where it was priced: no taps, no GPS refinements.
  const locked = (quote.isPending || quote.isSuccess) && quote.variables ? { lat: quote.variables.lat, lng: quote.variables.lng } : null;
  const at = locked ?? pin ?? here.loc;
  const center = at ?? shop;
  const quoted = locked !== null;
  const fee = quote.data?.total_delivery_fee ?? null;
  // The road is drawn only once Compute Delivery Fee is pressed, for the pin being priced.
  const route = useRoadRoute(quoted ? at : null, shop);

  const compute = () => at && quote.mutate({ store_id: store.id, lat: at.lat, lng: at.lng });
  const pickProof = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    upload.mutate({ uri: asset.uri, width: asset.width, height: asset.height }, { onSuccess: (key) => setProof({ uri: asset.uri, key }) });
  };
  // Either proof is enough: a reference number, or a photo of the payment.
  const hasProof = paymentRef.trim() !== '' || proof !== null;
  const sendProof = () =>
    at &&
    createOrder.mutate(
      {
        type: 'pickup',
        store_id: store.id,
        items: cart.lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })),
        lat: at.lat,
        lng: at.lng,
        payment_ref: paymentRef.trim(),
        payment_photo_key: proof?.key,
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
      <Card>
        <ThemedText type="smallBold">Deliver to</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {quoted ? 'Your pin is set for this delivery fee.' : 'Tap the map to move your pin.'}
        </ThemedText>
        {here.error && <ThemedText themeColor="textSecondary">{here.error}</ThemedText>}
        {center ? (
          <DropoffMap
            center={center}
            onPress={quoted ? undefined : setPin}
            path={quoted ? route.data?.path : undefined}
            pins={[
              ...(at ? [{ key: 'me', at, title: 'Deliver here', color: PinColor.customer, icon: 'person' as const }] : []),
              ...(shop ? [{ key: 'shop', at: shop, title: store.name, color: PinColor.shop, icon: 'store' as const }] : []),
            ]}
          />
        ) : (
          <ActivityIndicator />
        )}
        {fee !== null ? (
          <View style={styles.row}>
            <ThemedText type="small" style={styles.grow}>
              Delivery fee · {quote.data!.road_km.toFixed(1)} km
            </ThemedText>
            <ThemedText type="smallBold">{peso(fee)}</ThemedText>
          </View>
        ) : (
          <Button title="Compute Delivery Fee" variant="secondary" onPress={compute} loading={quote.isPending} disabled={!at} />
        )}
        <ErrorText error={details.error ?? quote.error} />
      </Card>
      {fee !== null && (
        <Card>
          <ThemedText type="smallBold">Payment</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Pay {peso(cart.itemsTotal + fee)} to {store.name}, then send your proof of payment.
          </ThemedText>
          {details.data?.store_payment_gateway.length ? (
            details.data.store_payment_gateway.map((g) => (
              <View key={g.image_url} style={styles.qr}>
                <Image testID="payment-qr" source={{ uri: g.image_url }} style={styles.qrImage} contentFit="contain" />
                <ThemedText type="smallBold">{g.label}</ThemedText>
              </View>
            ))
          ) : (
            <ThemedText themeColor="textSecondary">This store hasn&apos;t added a payment QR yet.</ThemedText>
          )}
          <TextField label="Reference number" value={paymentRef} onChangeText={setPaymentRef} autoCapitalize="characters" autoCorrect={false} />
          {proof && <Image testID="payment-proof" source={{ uri: proof.uri }} style={styles.proof} contentFit="cover" />}
          <Button
            title={proof ? 'Change photo' : 'Upload photo'}
            variant="secondary"
            icon={{ ios: 'photo', android: 'image', web: 'image' }}
            onPress={pickProof}
            loading={upload.isPending}
          />
          <ThemedText type="small" themeColor="textSecondary">
            A reference number or a photo is enough.
          </ThemedText>
          <ErrorText error={upload.error ?? createOrder.error} />
          <Button title="Send proof of payment" onPress={sendProof} loading={createOrder.isPending} disabled={!hasProof || upload.isPending} />
        </Card>
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
  qr: { alignItems: 'center', gap: Spacing.one },
  qrImage: { width: 200, height: 200, borderRadius: 12 },
  proof: { width: '100%', height: 200, borderRadius: 12 },
});
