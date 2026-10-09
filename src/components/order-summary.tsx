import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { orderTitle, peso, route, STATUS_LABEL } from '@/lib/format';
import type { Order, OrderDetail } from '@/lib/types';

export function OrderSummary({ order }: { order: Order | OrderDetail }) {
  const { from, to } = route(order);
  return (
    <View style={styles.summary}>
      <View style={styles.header}>
        <ThemedText type="smallBold" style={styles.title}>
          {orderTitle(order)} · {order.store_name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          #{order.id}
        </ThemedText>
      </View>
      <ThemedText type="small">{STATUS_LABEL[order.status]}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        From: {from}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        To: {to}
      </ThemedText>
      {'items' in order &&
        order.items.map((item) => (
          <ThemedText key={item.id} type="small">
            {item.qty} × {item.name} — {peso(item.price * item.qty)}
          </ThemedText>
        ))}
      {order.notes ? <ThemedText type="small">Notes: {order.notes}</ThemedText> : null}
      <ThemedText type="smallBold">Total (cash): {peso(order.items_total + order.delivery_fee)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.one },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1 },
});
