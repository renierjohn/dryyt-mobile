import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder } from '@/hooks/queries';
import { useCart } from '@/hooks/use-cart';
import { discountedPrice, peso } from '@/lib/format';

export default function CartScreen() {
  const cart = useCart();
  const createOrder = useCreateOrder();
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  if (!cart.store) {
    return (
      <Screen edges={[]}>
        <ThemedText themeColor="textSecondary">Your cart is empty.</ThemedText>
        <Button title="Browse popular" variant="secondary" onPress={() => router.replace('/customer/popular')} />
      </Screen>
    );
  }

  const store = cart.store;
  const submit = () =>
    createOrder.mutate(
      {
        type: 'pickup',
        store_id: store.id,
        items: cart.lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty })),
        customer_address: address,
        notes,
      },
      {
        onSuccess: (order) => {
          cart.clear();
          router.replace({ pathname: '/customer/order/[id]', params: { id: String(order.id) } });
        },
      },
    );

  return (
    <Screen
      edges={[]}
      footer={
        <>
          <ThemedText type="smallBold">Items {peso(cart.itemsTotal)} + delivery fee</ThemedText>
          <ErrorText error={createOrder.error} />
          <Button title="Place order" onPress={submit} loading={createOrder.isPending} />
        </>
      }>
      <Card>
        <ThemedText type="smallBold">{store.name}</ThemedText>
        {cart.lines.map(({ item, qty }) => (
          <View key={item.id} style={styles.row}>
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
      <TextField label="Delivery address" value={address} onChangeText={setAddress} multiline />
      <TextField label="Notes" placeholder="e.g. less ice, no onions" value={notes} onChangeText={setNotes} multiline />
      <ThemedText type="small" themeColor="textSecondary">
        Pay cash to the driver.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
