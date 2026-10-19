import { StyleSheet, View } from 'react-native';

import { DishPhoto } from '@/components/dish-photo';
import { Icon } from '@/components/icon';
import { StatusBadge } from '@/components/status-badge';
import { StoreLogo } from '@/components/store-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { orderTitle, peso, route, STATUS_LABEL } from '@/lib/format';
import type { Order, OrderDetail } from '@/lib/types';

/**
 * `showFees`: the driver's and owner's view, with the delivery fee split into the driver's share and the service fee.
 * Customers see one delivery fee that already includes the service fee.
 * `badge`: the customer's order list, "#id · Pickup · store" with the status pill top right like drop off cards.
 * `youEarn`: the driver's job board and history, marking the driver's share of the delivery fee.
 * `orderTotal`: the owner's view, with the order amount as "Total Order" above the fees.
 */
export function OrderSummary({
  order,
  showFees = false,
  badge = false,
  youEarn = false,
  orderTotal = false,
}: {
  order: Order | OrderDetail;
  showFees?: boolean;
  badge?: boolean;
  youEarn?: boolean;
  orderTotal?: boolean;
}) {
  const theme = useTheme();
  const { from, to } = route(order);
  return (
    <View style={styles.summary}>
      {badge ? (
        <View style={styles.header}>
          <StoreLogo uri={order.store_logo} testID="order-store-logo" />
          <ThemedText type="smallBold" style={styles.title}>
            #{order.id} · Pickup · {order.store_name}
          </ThemedText>
          <StatusBadge
            label={STATUS_LABEL[order.status]}
            tone={order.status === 'delivered' ? 'success' : order.status === 'cancelled' ? 'danger' : 'muted'}
          />
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              {orderTitle(order)} · {order.store_name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              #{order.id}
            </ThemedText>
          </View>
          {/* Green once delivered, red when cancelled. */}
          <ThemedText
            type="small"
            style={order.status === 'delivered' ? { color: theme.success } : order.status === 'cancelled' ? { color: theme.danger } : undefined}>
            {STATUS_LABEL[order.status]}
          </ThemedText>
        </>
      )}
      {/* Where the driver collects: the store's address. */}
      <View style={styles.item}>
        <Icon name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={16} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          {from}
        </ThemedText>
      </View>
      {/* A pinned spot's address is just coordinates ("Pinned location 14.56000, 121.03000"): the map shows it instead. */}
      {!to.startsWith('Pinned location') && (
        <ThemedText type="small" themeColor="textSecondary">
          To: {to}
        </ThemedText>
      )}
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
      {showFees ? (
        <>
          {orderTotal && (
            <View style={styles.item}>
              <ThemedText type="small" style={styles.grow}>
                Total Order
              </ThemedText>
              <ThemedText type="small">{peso(order.items_total)}</ThemedText>
            </View>
          )}
          <View style={styles.item}>
            <ThemedText type="small" style={styles.grow}>
              Delivery fee{youEarn && <ThemedText type="small" style={{ color: theme.success }}> (You Earn)</ThemedText>}
            </ThemedText>
            <ThemedText type="small">{peso(order.delivery_fee - order.service_fee)}</ThemedText>
          </View>
          <View style={styles.item}>
            <ThemedText type="small" style={styles.grow}>
              Service fee
            </ThemedText>
            <ThemedText type="small">{peso(order.service_fee)}</ThemedText>
          </View>
        </>
      ) : (
        <>
          <View style={styles.item}>
            <ThemedText type="small" style={styles.grow}>
              Order amount
            </ThemedText>
            <ThemedText type="small">{peso(order.items_total)}</ThemedText>
          </View>
          <View style={styles.item}>
            <ThemedText type="small" style={styles.grow}>
              Delivery fee
            </ThemedText>
            <ThemedText type="small">{peso(order.delivery_fee)}</ThemedText>
          </View>
        </>
      )}
      <View testID="order-grand-total-separator" style={[styles.separator, { backgroundColor: theme.border }]} />
      <View style={styles.item}>
        <ThemedText type="smallBold" style={styles.grow}>
          Total Amount
        </ThemedText>
        <ThemedText type="smallBold">{peso(order.items_total + order.delivery_fee)}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
});
