import { Image, type ImageSource } from 'expo-image';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { NextLoadCountdown } from '@/components/next-load-countdown';
import { OrderSummary } from '@/components/order-summary';
import { PhotoViewer } from '@/components/photo-viewer';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useConfirmPayment, useOwnerOrders } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { apiUrl, authHeaders } from '@/lib/api';
import { dayLabel, localDay, peso } from '@/lib/format';
import type { Order } from '@/lib/types';

/** Orders come newest first, so each local day of placing is one run. */
const groupKey = (o: Order) => localDay(o.created_at);

export default function Orders() {
  const theme = useTheme();
  const orders = useOwnerOrders();
  const confirm = useConfirmPayment();
  const [viewing, setViewing] = useState<ImageSource | null>(null);
  // The worker already sorts: newest first.
  const list = orders.data?.pages.flatMap((p) => p.orders) ?? [];

  // Rows are direct children of the scroll view so each day's title can stick to the top until the next one pushes it off.
  const rows: ReactElement[] = [];
  const sticky: number[] = [];
  list.forEach((o, i) => {
    if (i === 0 || groupKey(list[i - 1]) !== groupKey(o)) {
      // The day's order amounts (items only, no delivery fee); cancelled orders don't count.
      const dayTotal = list.filter((x) => x.status !== 'cancelled' && groupKey(x) === groupKey(o)).reduce((sum, x) => sum + x.items_total, 0);
      sticky.push(rows.length);
      rows.push(
        <View key={`day-${groupKey(o)}`} testID="order-day" style={[styles.groupTitle, { backgroundColor: theme.background }]}>
          <ThemedText style={[styles.groupTitleText, styles.grow]}>{dayLabel(o.created_at)}</ThemedText>
          <View style={styles.groupTotal}>
            <ThemedText style={[styles.groupTitleText, { color: theme.primary }]}>{peso(dayTotal)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              orders
            </ThemedText>
          </View>
        </View>,
      );
    }
    const photo = { uri: apiUrl(`/owner/orders/${o.id}/payment-photo`), headers: authHeaders() };
    rows.push(
      <Card key={o.id}>
        <OrderSummary order={o} showFees />
        {o.payment_ref ? <ThemedText type="small">Reference no.: {o.payment_ref}</ThemedText> : null}
        {o.payment_photo_key && (
          <Pressable accessibilityLabel="View payment photo" onPress={() => setViewing(photo)}>
            <Image testID={`payment-photo-${o.id}`} source={photo} style={styles.photo} contentFit="contain" />
          </Pressable>
        )}
        {o.status === 'awaiting_payment' && (
          <Button title="Done Pay" loading={confirm.isPending && confirm.variables === o.id} onPress={() => confirm.mutate(o.id)} />
        )}
      </Card>,
    );
  });

  // The fixed rows above the list, null ones dropped so `sticky` indexes line up with the scroll view's children.
  const top = [
    <ThemedText key="title" type="subtitle">
      Orders
    </ThemedText>,
    __DEV__ && <NextLoadCountdown key="countdown" at={orders.nextAt} label="/owner/orders" />,
    orders.isPending && <ActivityIndicator key="loading" />,
    <ErrorText key="error" error={orders.error ?? confirm.error} />,
    orders.isSuccess && list.length === 0 && (
      <ThemedText key="empty" themeColor="textSecondary">
        No orders yet.
      </ThemedText>
    ),
  ].filter((row): row is ReactElement => Boolean(row));

  return (
    <Screen onRefresh={orders.refresh} stickyHeaderIndices={sticky.map((i) => i + top.length)}>
      {top}
      {rows}
      {orders.hasNextPage && (
        <Button title="Show More" variant="secondary" loading={orders.isFetchingNextPage} onPress={() => orders.fetchNextPage()} />
      )}
      <PhotoViewer source={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  groupTitleText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  grow: { flex: 1 },
  groupTotal: { alignItems: 'flex-end' },
  photo: { width: '100%', height: 280, borderRadius: 12 },
});
