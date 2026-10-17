import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useStore } from '@/hooks/queries';
import { confirmReplace, useCart } from '@/hooks/use-cart';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

export default function NewOrder() {
  const storeId = Number(useLocalSearchParams<{ storeId: string }>().storeId);
  const store = useStore(storeId);
  const cart = useCart();
  const createOrder = useCreateOrder();
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

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
    if (cart.add(item, shop, delta) === 'needs-replace') confirmReplace(cart.store!.name, () => cart.replace(item, shop, delta));
  };

  // Laundry pickups have no items: order straight from here.
  if (type === 'laundry') {
    const submit = () =>
      createOrder.mutate(
        { type: 'pickup', store_id: storeId, items: [], customer_address: address, notes },
        { onSuccess: (order) => router.replace({ pathname: '/customer/order/[id]', params: { id: String(order.id) } }) },
      );
    return (
      <Screen
        edges={[]}
        footer={
          <>
            <ErrorText error={createOrder.error} />
            <Button title="Place order" onPress={submit} loading={createOrder.isPending} />
          </>
        }>
        <Card>
          <ThemedText type="smallBold">{name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {storeAddress}
          </ThemedText>
        </Card>
        <TextField label="Delivery address" value={address} onChangeText={setAddress} multiline />
        <TextField label="Notes" placeholder="e.g. claim ticket #, number of bags" value={notes} onChangeText={setNotes} multiline />
        <ThemedText type="small" themeColor="textSecondary">
          Pay cash to the driver.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen
      edges={[]}
      footer={
        <Button
          title={cart.count > 0 ? `View cart · ${peso(cart.itemsTotal)}` : 'View cart'}
          onPress={() => router.push('/customer/cart')}
          disabled={cart.count === 0}
        />
      }>
      <Card>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {storeAddress}
        </ThemedText>
      </Card>
      {menu.map((item) => (
        <Card key={item.id} onPress={() => router.push({ pathname: '/customer/menu/[id]', params: { id: String(item.id), storeId: String(storeId) } })}>
          <View style={styles.row}>
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
            </View>
            <Stepper value={inThisCart ? cart.qtyOf(item.id) : 0} onChange={(delta) => change(item, delta)} />
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
});
