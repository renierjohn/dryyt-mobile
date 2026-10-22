import { router } from 'expo-router';
import { type ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { StatusBadge, type Tone } from '@/components/status-badge';
import { StoreLogo } from '@/components/store-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHistory, type HistoryItem } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { dateTime, dayLabel, DROPOFF_STATUS_LABEL, localDay, peso } from '@/lib/format';
import type { DropoffStatus } from '@/lib/types';

/** Only customers and drivers have a history. */
type Role = 'customer' | 'driver';

/** The worker lists shop-confirmed drop offs first, then newest; each of those runs is one group. */
const groupKey = (item: HistoryItem, role: Role) => (pinned(item) ? 'pinned' : localDay(sortedAt(item, role)));

type Props = {
  /** From useHistory(). */
  history: ReturnType<typeof useHistory>;
  role: Role;
  /** The row above the list. */
  title: ReactElement;
  empty: string;
  /** A group's amount, shown on the right of its title. */
  amount?: (items: HistoryItem[]) => number;
};

/** Paged orders and drop offs grouped by day under titles that stick to the top, with a "See More" button. */
export function HistoryScreen({ history, role, title, empty, amount }: Props) {
  const theme = useTheme();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  // Rows are direct children of the scroll view so each group's title can stick to the top until the next one pushes it off.
  const rows: ReactElement[] = [];
  const sticky: number[] = [];
  items.forEach((item, i) => {
    const key = groupKey(item, role);
    if (i === 0 || groupKey(items[i - 1], role) !== key) {
      sticky.push(rows.length);
      rows.push(
        <View key={`group-${key}`} testID="history-day" style={[styles.groupTitle, { backgroundColor: theme.background }]}>
          <ThemedText style={[styles.groupTitleText, styles.grow]}>
            {key === 'pinned' ? DROPOFF_STATUS_LABEL.owner_confirmed : dayLabel(sortedAt(item, role))}
          </ThemedText>
          {amount && (
            <ThemedText style={[styles.groupTitleText, { color: theme.success }]}>
              {peso(amount(items.filter((x) => groupKey(x, role) === key)))}
            </ThemedText>
          )}
        </View>,
      );
    }
    rows.push(<HistoryCard key={historyKey(item)} item={item} role={role} />);
  });

  // The fixed rows above the list, null ones dropped so `sticky` indexes line up with the scroll view's children.
  const top = [
    title,
    history.isPending && <ActivityIndicator key="loading" />,
    <ErrorText key="error" error={history.error} />,
    history.isSuccess && items.length === 0 && (
      <ThemedText key="empty" themeColor="textSecondary">
        {empty}
      </ThemedText>
    ),
  ].filter((row): row is ReactElement => Boolean(row));

  return (
    <Screen onRefresh={history.refresh} stickyHeaderIndices={sticky.map((i) => i + top.length)}>
      {top}
      {rows}
      {history.hasNextPage && (
        <Button title="See More" variant="secondary" loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />
      )}
    </Screen>
  );
}

export function HistoryCard({ item, role }: { item: HistoryItem; role: Role }) {
  const theme = useTheme();
  if (item.kind === 'order') {
    const { order } = item;
    // Like closed drop offs, a cancelled order has nothing to open.
    return (
      <Card onPress={role === 'customer' && order.status !== 'cancelled' ? () => router.push(`/customer/order/${order.id}`) : undefined}>
        <OrderSummary order={order} showFees={role === 'driver'} youEarn={role === 'driver'} badge={role === 'customer'} />
      </Card>
    );
  }
  const d = item.dropoff;
  // Same figure as the summary's "Total to pay the shop"; before the laundry fee is known, just the delivery fee.
  const amount =
    d.laundry_fee !== null ? `${peso(d.total_delivery_fee + d.laundry_fee)}` : `${peso(d.total_delivery_fee)}`;
  // Nothing to look at in a cancelled or unmatched drop off; unmatched ones are faded too.
  const closed = d.status === 'cancelled' || d.status === 'expired';
  return (
    <Card
      style={d.status === 'expired' ? styles.faded : undefined}
      onPress={
        role === 'customer' && !closed ? () => router.push({ pathname: '/customer/dropoff/[id]', params: { id: String(d.id) } }) : undefined
      }>
      <View style={styles.header}>
        {role === 'customer' && <StoreLogo uri={d.store_logo} testID="dropoff-store-logo" />}
        <ThemedText type="smallBold" style={styles.title}>
          Drop off · {d.store_name}
          {role === 'driver' ? ` · ${d.customer_name}` : ''}
        </ThemedText>
        <StatusBadge label={DROPOFF_STATUS_LABEL[d.status]} tone={BADGE_TONE[d.status] ?? 'muted'} />
      </View>
      {role === 'driver' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {dateTime(d.created_at)}
          </ThemedText>
          {/* Like the driver's order cards: their share, the service fee, then what the customer pays for delivery. */}
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
          <View style={styles.meta}>
            <ThemedText type="small">
              Delivery fee<ThemedText type="small" style={{ color: theme.success }}> (You Earn)</ThemedText>
            </ThemedText>
            <ThemedText type="small">{peso(d.delivery_fee ?? 0)}</ThemedText>
          </View>
          <View style={styles.meta}>
            <ThemedText type="small">Service fee</ThemedText>
            <ThemedText type="small">{peso(d.service_fee ?? 0)}</ThemedText>
          </View>
          <View testID="dropoff-total-separator" style={[styles.separator, { backgroundColor: theme.border }]} />
          <View style={styles.meta}>
            <ThemedText type="smallBold">Total Amount</ThemedText>
            <ThemedText type="smallBold">{peso(d.total_delivery_fee)}</ThemedText>
          </View>
        </>
      ) : (
        <View style={styles.meta}>
          <ThemedText type="smallBold">{amount}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {dateTime(d.created_at)}
          </ThemedText>
        </View>
      )}
    </Card>
  );
}

export function historyKey(item: HistoryItem) {
  return item.kind === 'order' ? `order-${item.order.id}` : `dropoff-${item.dropoff.id}`;
}

/** The timestamp the worker sorts by: when customers placed it, when drivers finished it. */
export function sortedAt(item: HistoryItem, role: Role) {
  const row = item.kind === 'order' ? item.order : item.dropoff;
  return role === 'customer' ? row.created_at : row.updated_at;
}

export const pinned = (item: HistoryItem) => item.kind === 'dropoff' && item.dropoff.status === 'owner_confirmed';

/** Shop confirmed = waiting for payment (listed first by the worker); everything not listed is muted. */
const BADGE_TONE: Partial<Record<DropoffStatus, Tone>> = { completed: 'success', owner_confirmed: 'warning', cancelled: 'danger' };

const styles = StyleSheet.create({
  faded: { opacity: 0.8 },
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  groupTitleText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  grow: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { flex: 1 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
});
