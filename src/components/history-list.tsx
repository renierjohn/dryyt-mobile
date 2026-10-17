import { router } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { StatusBadge, type Tone } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHistory, type HistoryItem } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { dateTime, DROPOFF_STATUS_LABEL, localDay, peso } from '@/lib/format';
import type { DropoffStatus } from '@/lib/types';

/** Paged orders and drop offs with a "See More" button; `history` comes from useHistory(). */
export function HistoryList({ history, role, empty }: { history: ReturnType<typeof useHistory>; role: 'customer' | 'driver'; empty: string }) {
  const theme = useTheme();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      {__DEV__ && <NextLoadCountdown at={history.nextAt} />}
      {history.isPending && <ActivityIndicator />}
      <ErrorText error={history.error} />
      {history.isSuccess && items.length === 0 && <ThemedText themeColor="textSecondary">{empty}</ThemedText>}
      {items.map((item, i) => (
        <Fragment key={historyKey(item)}>
          <HistoryCard item={item} role={role} />
          {/* Line under the shop-confirmed group the worker lists first, and between days after it. */}
          {i + 1 < items.length && lineBetween(item, items[i + 1], role) && (
            <View style={[styles.separator, { backgroundColor: theme.border }]} />
          )}
        </Fragment>
      ))}
      {history.hasNextPage && (
        <Button title="See More" variant="secondary" loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />
      )}
    </>
  );
}

/** Dev builds only: seconds until focus or pull-to-refresh may request /history again. */
function NextLoadCountdown({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <ThemedText type="small" themeColor="textSecondary">
      [dev] /history {left > 0 ? `refresh in ${left}s` : 'refreshes on focus or pull'}
    </ThemedText>
  );
}

export function HistoryCard({ item, role }: { item: HistoryItem; role: 'customer' | 'driver' }) {
  if (item.kind === 'order') {
    const { order } = item;
    return (
      <Card onPress={role === 'customer' ? () => router.push(`/customer/order/${order.id}`) : undefined}>
        <OrderSummary order={order} />
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
        <ThemedText type="smallBold" style={styles.title}>
          Drop off · {d.store_name}
          {role === 'driver' ? ` · ${d.customer_name}` : ''}
        </ThemedText>
        <StatusBadge label={DROPOFF_STATUS_LABEL[d.status]} tone={BADGE_TONE[d.status] ?? 'muted'} />
      </View>
      <View style={styles.meta}>
        <ThemedText type="smallBold">{amount}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {dateTime(d.created_at)}
        </ThemedText>
      </View>
    </Card>
  );
}

export function historyKey(item: HistoryItem) {
  return item.kind === 'order' ? `order-${item.order.id}` : `dropoff-${item.dropoff.id}`;
}

/** The timestamp the worker sorts by: when customers placed it, when drivers finished it. */
function sortedAt(item: HistoryItem, role: 'customer' | 'driver') {
  const row = item.kind === 'order' ? item.order : item.dropoff;
  return role === 'customer' ? row.created_at : row.updated_at;
}

function lineBetween(a: HistoryItem, b: HistoryItem, role: 'customer' | 'driver') {
  if (pinned(a)) return !pinned(b);
  return localDay(sortedAt(a, role)) !== localDay(sortedAt(b, role));
}

const pinned = (item: HistoryItem) => item.kind === 'dropoff' && item.dropoff.status === 'owner_confirmed';

/** Shop confirmed = waiting for payment (listed first by the worker); everything not listed is muted. */
const BADGE_TONE: Partial<Record<DropoffStatus, Tone>> = { completed: 'success', owner_confirmed: 'warning', cancelled: 'danger' };

const styles = StyleSheet.create({
  faded: { opacity: 0.8 },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { flex: 1 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
