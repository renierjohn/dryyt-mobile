import { StyleSheet, View } from 'react-native';

import { DishPhoto } from '@/components/dish-photo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { orderTitle, peso, route, STATUS_LABEL } from '@/lib/format';
import type { Order, OrderDetail } from '@/lib/types';

export function OrderSummary({ order }: { order: Order | OrderDetail }) {
  const theme = useTheme();
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
          <View key={item.id} style={styles.item}>
            <DishPhoto uri={item.image_url} size={48} testID={`order-item-photo-${item.id}`} />
            <ThemedText type="small" style={styles.grow}>
              {item.qty} × {item.name}
            </ThemedText>
            <ThemedText type="small">{peso(item.price * item.qty)}</ThemedText>
          </View>
        ))}
      {order.notes ? <ThemedText type="small">Notes: {order.notes}</ThemedText> : null}
      <View testID="order-total-separator" style={[styles.separator, { backgroundColor: theme.border }]} />
      <View style={styles.item}>
        <ThemedText type="smallBold" style={styles.grow}>
          Total (cash)
        </ThemedText>
        <ThemedText type="smallBold">{peso(order.items_total + order.delivery_fee)}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.one },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
});
