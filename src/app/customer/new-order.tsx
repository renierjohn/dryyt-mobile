import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { StatusBadge } from '@/components/status-badge';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCreateOrder, useStore } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';

export default function NewOrder() {
  const params = useLocalSearchParams<{ storeId: string }>();
  const storeId = Number(params.storeId);
  const store = useStore(storeId);
  const createOrder = useCreateOrder();
  const [qty, setQty] = useState<Record<number, number>>({});
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
  const isFood = type === 'food';
  const items = menu.filter((m) => (qty[m.id] ?? 0) > 0).map((m) => ({ menu_item_id: m.id, qty: qty[m.id] }));
  const itemsTotal = menu.reduce((sum, m) => sum + discountedPrice(m) * (qty[m.id] ?? 0), 0);
  const change = (id: number, delta: number) =>
    setQty((q) => ({ ...q, [id]: Math.min(50, Math.max(0, (q[id] ?? 0) + delta)) }));

  const submit = () =>
    createOrder.mutate(
      { type: 'pickup', store_id: storeId, items, customer_address: address, notes },
      { onSuccess: (order) => router.replace(`/customer/order/${order.id}`) },
    );

  return (
    <Screen
      edges={[]}
      footer={
        <>
          {isFood && (
            <View style={styles.row}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                Items + delivery fee
              </ThemedText>
              <ThemedText type="smallBold">{peso(itemsTotal)}</ThemedText>
            </View>
          )}
          <ErrorText error={createOrder.error} />
          <Button title="Place order" onPress={submit} loading={createOrder.isPending} disabled={isFood && items.length === 0} />
        </>
      }>
      <Card>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {storeAddress}
        </ThemedText>
      </Card>
      {isFood &&
        menu.map((item) => (
          <Card key={item.id}>
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
              <Stepper value={qty[item.id] ?? 0} onChange={(delta) => change(item.id, delta)} />
            </View>
          </Card>
        ))}
      <TextField label="Delivery address" value={address} onChangeText={setAddress} multiline />
      <TextField
        label="Notes"
        placeholder={isFood ? 'e.g. less ice, no onions' : 'e.g. claim ticket #, number of bags'}
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      <ThemedText type="small" themeColor="textSecondary">
        Pay cash to the driver.
      </ThemedText>
    </Screen>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (delta: number) => void }) {
  const theme = useTheme();
  const step = (symbol: string, delta: number) => (
    <Pressable onPress={() => onChange(delta)} style={[styles.step, { backgroundColor: theme.primarySoft }]}>
      <ThemedText type="smallBold" style={{ color: theme.primary }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {step('−', -1)}
      <ThemedText type="smallBold" style={styles.count}>
        {value}
      </ThemedText>
      {step('+', 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  itemText: { gap: Spacing.half },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  struck: { textDecorationLine: 'line-through' },
  step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 24, textAlign: 'center' },
});
