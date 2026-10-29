import { Image, type ImageSource } from 'expo-image';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { OrderSummary } from '@/components/order-summary';
import { PhotoViewer } from '@/components/photo-viewer';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useConfirmPayment, useOwnerOrders, useSetLaundryFee } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { apiUrl, authHeaders } from '@/lib/api';
import { dayLabel, localDay, peso, STATUS_LABEL } from '@/lib/format';
import type { Order, StoreType } from '@/lib/types';

/** Orders come newest first, so each local day of placing is one run. */
const groupKey = (o: Order) => localDay(o.created_at);

/**
 * The owner's pickup orders of one kind: `food` (the Orders tab) or `laundry` (the Pickups tab), grouped by day.
 */
export function OwnerOrders({ type, title }: { type: StoreType; title: string }) {
  const theme = useTheme();
  const orders = useOwnerOrders(type);
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
    rows.push(<OrderCard key={o.id} order={o} onViewPhoto={setViewing} confirm={confirm} />);
  });

  // The fixed rows above the list, null ones dropped so `sticky` indexes line up with the scroll view's children.
  const top = [
    <ThemedText key="title" type="subtitle">
      {title}
    </ThemedText>,
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

/** Collapsed (unless awaiting payment) to store, order amount, number, status and total; "Show More" opens the full summary, proof of payment and Done Pay. */
function OrderCard({
  order: o,
  onViewPhoto,
  confirm,
}: {
  order: Order;
  onViewPhoto: (photo: ImageSource) => void;
  confirm: ReturnType<typeof useConfirmPayment>;
}) {
  const theme = useTheme();
  // Orders waiting on the owner (laundry fee, payment) start open, so Confirm or Done Pay is in reach.
  const [open, setOpen] = useState(o.status === 'awaiting_payment' || o.status === 'awaiting_fee');
  const photo = { uri: apiUrl(`/owner/orders/${o.id}/payment-photo`), headers: authHeaders() };
  return (
    <Card>
      {/* The customer's note first, big: for laundry it says which laundry to send. */}
      {o.notes ? (
        <ThemedText style={styles.notes}>
          <ThemedText type="small" themeColor="textSecondary">
            Notes:{' '}
          </ThemedText>
          <ThemedText testID={`order-notes-${o.id}`} style={styles.notes}>
            {o.notes}
          </ThemedText>
        </ThemedText>
      ) : null}
      {open ? (
        <>
          <OrderSummary order={o} showFees orderTotal hideNotes />
          {o.payment_ref ? <ThemedText type="small">Reference no.: {o.payment_ref}</ThemedText> : null}
          {o.payment_photo_key && (
            <Pressable accessibilityLabel="View payment photo" onPress={() => onViewPhoto(photo)}>
              <Image testID={`payment-photo-${o.id}`} source={photo} style={styles.photo} contentFit="contain" />
            </Pressable>
          )}
          {o.status === 'awaiting_fee' && <LaundryFeeForm orderId={o.id} />}
          {o.status === 'awaiting_payment' && (
            <Button title="Done Pay" loading={confirm.isPending && confirm.variables === o.id} onPress={() => confirm.mutate(o.id)} />
          )}
        </>
      ) : (
        <>
          <View style={styles.row}>
            <ThemedText type="smallBold" style={styles.grow}>
              Pickup @ {o.store_name} <ThemedText type="smallBold" testID={`order-amount-${o.id}`} style={{ color: theme.success }}>
                {o.status === 'awaiting_fee' ? 'Set laundry fee' : peso(o.items_total)}
              </ThemedText>
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              #{o.id}
            </ThemedText>
          </View>
          <View style={styles.row}>
            {/* Green once delivered, red when cancelled, like the full summary. */}
            <ThemedText
              type="small"
              style={[styles.grow, o.status === 'delivered' ? { color: theme.success } : o.status === 'cancelled' ? { color: theme.danger } : undefined]}>
              {STATUS_LABEL[o.status]}
            </ThemedText>
            <ThemedText type="smallBold">{peso(o.items_total + o.total_delivery_fee)}</ThemedText>
          </View>
        </>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={`${open ? 'Show less' : 'Show more'} of order #${o.id}`} onPress={() => setOpen(!open)}>
        <ThemedText type="smallBold" style={[styles.toggle, { color: theme.primary }]}>
          {open ? 'Show Less' : 'Show More'}
        </ThemedText>
      </Pressable>
    </Card>
  );
}

/** Laundry pickup: the shop reads the customer's note and sets the laundry fee; the customer then pays the total. */
function LaundryFeeForm({ orderId }: { orderId: number }) {
  const theme = useTheme();
  const setFee = useSetLaundryFee();
  const [amount, setAmount] = useState('');
  // The customer already paid the laundry at the shop: nothing left but the delivery.
  const [fullyPaid, setFullyPaid] = useState(false);
  // Pesos as typed ("250" or "250.50"), in centavos.
  const typed = /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount.trim()) * 100) : null;
  const centavos = fullyPaid ? 0 : typed;
  const togglePaid = () => {
    setFullyPaid(!fullyPaid);
    setAmount(fullyPaid ? '' : '0');
  };
  return (
    <>
      <TextField
        label="Laundry fee (₱)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="e.g. 250"
        editable={!fullyPaid}
        style={fullyPaid ? styles.disabled : undefined}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: fullyPaid }}
        accessibilityLabel="Laundry Fully Paid"
        onPress={togglePaid}
        hitSlop={8}
        style={[styles.row, styles.check]}>
        <Icon
          name={
            fullyPaid
              ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' }
              : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }
          }
          size={26}
          color={fullyPaid ? theme.primary : theme.textSecondary}
        />
        <ThemedText type="default">Laundry Fully Paid</ThemedText>
      </Pressable>
      <ErrorText error={setFee.error} />
      <Button
        title="Confirm"
        loading={setFee.isPending}
        disabled={centavos === null || (!fullyPaid && centavos < 100)}
        onPress={() => centavos !== null && setFee.mutate({ id: orderId, laundry_fee: centavos })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  toggle: { textAlign: 'center', paddingTop: Spacing.one },
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  groupTitleText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  grow: { flex: 1 },
  groupTotal: { alignItems: 'flex-end' },
  photo: { width: '100%', height: 280, borderRadius: 12 },
  notes: { fontSize: 18, lineHeight: 26, fontWeight: 700 },
  disabled: { opacity: 0.5 },
  check: { marginVertical: Spacing.two },
});
