import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { CategoryChips } from '@/components/category-chips';
import { DeliveryPinCard, useDeliveryPin } from '@/components/delivery-pin';
import { ErrorText } from '@/components/error-text';
import { HeaderBand } from '@/components/header-band';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useStore } from '@/hooks/queries';
import { useCart } from '@/hooks/use-cart';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

export default function NewOrder() {
  const storeId = Number(useLocalSearchParams<{ storeId: string }>().storeId);
  const store = useStore(storeId);
  const cart = useCart();
  const [category, setCategory] = useState<string | null>(null);
  const theme = useTheme();

  if (store.isPending) {
    return (
      <Screen edges={[]}>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (store.isError) {
    return (
      <Screen edges={[]}>
        <ErrorText error={store.error} />
      </Screen>
    );
  }

  const { name, address: storeAddress, type, menu } = store.data;
  const shop = { id: storeId, name };
  const inThisCart = cart.store?.id === storeId;

  const change = (item: MenuItem, delta: number) => {
    if (inThisCart && cart.qtyOf(item.id) > 0) return cart.setQty(item.id, cart.qtyOf(item.id) + delta);
    if (delta <= 0) return;
    if (cart.add(item, shop, delta) === 'needs-replace') cart.confirmReplace(() => cart.replace(item, shop, delta));
  };

  // Laundry pickups have no items: pin, price the delivery, then tell the shop which laundry to send.
  if (type === 'laundry') return <LaundryPickup storeId={storeId} name={name} storeAddress={storeAddress} />;

  // Categories in the owner's menu order; tabs only when the store uses them.
  const categories = [...new Set(menu.map((m) => m.category).filter(Boolean))];
  const shown = category ? menu.filter((m) => m.category === category) : menu;

  return (
    <Screen
      edges={[]}
      header={
        <>
          {/* The navigation bar turns blue too, so it runs into the band. */}
          <Stack.Screen
            options={{
              title: '',
              headerStyle: { backgroundColor: theme.primary },
              headerTintColor: theme.onPrimary,
              headerShadowVisible: false,
            }}
          />
          <HeaderBand title={name} subtitle={storeAddress} backgroundImage={store.data.store_logo} inset={false} />
          {categories.length > 0 && (
            <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
              <CategoryChips categories={categories} selected={category} onSelect={setCategory} />
            </View>
          )}
        </>
      }
      footer={
        <Button
          title={cart.count > 0 ? `View cart · ${peso(cart.itemsTotal)}` : 'View cart'}
          onPress={() => router.push('/customer/cart')}
          disabled={cart.count === 0}
        />
      }>
      {shown.map((item) => (
        <Card key={item.id} onPress={() => router.push({ pathname: '/customer/menu/[id]', params: { id: String(item.id), storeId: String(storeId) } })}>
          <View style={styles.row}>
            {item.image_url ? (
              <Image testID={`dish-photo-${item.id}`} source={{ uri: item.image_url }} style={styles.photo} contentFit="cover" />
            ) : (
              <View testID={`dish-photo-placeholder-${item.id}`} style={[styles.photo, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
                <Icon name={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} size={32} color={theme.primary} />
              </View>
            )}
            <View style={[styles.grow, styles.itemText]}>
              <View style={styles.nameRow}>
                <ThemedText type="small">{item.name}</ThemedText>
                {item.best_seller ? <StatusBadge label="Best seller" tone="info" /> : null}
              </View>
              <View style={styles.nameRow}>
                <ThemedText type="smallBold">{peso(discountedPrice(item))}</ThemedText>
                {item.discount_percent > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.struck}>
                    {peso(item.price)}
                  </ThemedText>
                )}
              </View>
              <Stepper value={inThisCart ? cart.qtyOf(item.id) : 0} onChange={(delta) => change(item, delta)} />
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  itemText: { gap: Spacing.half },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  struck: { textDecorationLine: 'line-through' },
  tabs: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  photo: { width: 96, height: 96, borderRadius: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});

/**
 * The shop's pin and the customer's on a map, Compute Delivery Fee, then a note for the shop. Send to shop creates the
 * order; the shop sets the laundry fee and the customer pays on the order's screen.
 */
function LaundryPickup({ storeId, name, storeAddress }: { storeId: number; name: string; storeAddress: string }) {
  const createOrder = useCreateOrder();
  const pin = useDeliveryPin(storeId);
  const [notes, setNotes] = useState('');
  const submit = () =>
    pin.at &&
    createOrder.mutate(
      { type: 'pickup', store_id: storeId, items: [], lat: pin.at.lat, lng: pin.at.lng, notes: notes.trim(), quote_token: pin.quote.data?.token },
      { onSuccess: (order) => router.replace({ pathname: '/customer/order/[id]', params: { id: String(order.id) } }) },
    );
  return (
    <Screen
      edges={[]}
      footer={
        pin.fee !== null && (
          <>
            <ErrorText error={createOrder.error} />
            <Button title="Send to shop" onPress={submit} loading={createOrder.isPending} disabled={notes.trim() === ''} />
          </>
        )
      }>
      <Card>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {storeAddress}
        </ThemedText>
      </Card>
      <DeliveryPinCard storeName={name} pin={pin} />
      {pin.fee !== null && (
        <>
          <TextField
            label="Note"
            placeholder="Tell the shop which laundry to send, e.g. claim ticket #, number of bags"
            value={notes}
            onChangeText={setNotes}
            multiline
          />
          <ThemedText type="small" themeColor="textSecondary">
            The shop sets the laundry fee next. You pay the shop before a driver is booked.
          </ThemedText>
        </>
      )}
    </Screen>
  );
}
