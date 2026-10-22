import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { StatusBadge, type Tone } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useOwnerDropoffs } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, DROPOFF_STATUS_LABEL, localDay, peso } from '@/lib/format';
import type { Dropoff, DropoffStatus } from '@/lib/types';

/** The owner's view of where a drop off stands; the worker only lists these statuses, sorted Not Yet Paid → Pending → Complete. */
const OWNER_BADGE: Partial<Record<DropoffStatus, { label: string; tone: Tone }>> = {
  dropped_off: { label: 'Pending', tone: 'warning' },
  owner_confirmed: { label: 'Pending', tone: 'warning' },
  completed: { label: 'Complete', tone: 'success' },
  payment_pending: { label: 'Not Yet Paid', tone: 'danger' },
};

/** A new date group starts when the badge group or the local day changes (the worker sorts by badge, then newest). */
const groupKey = (d: Dropoff) => `${OWNER_BADGE[d.status]?.label}|${localDay(d.updated_at)}`;

export default function OwnerDropoffs() {
  const theme = useTheme();
  const dropoffs = useOwnerDropoffs();
  // The worker already sorts by badge group, then newest; 10 per page.
  const list = dropoffs.data?.pages.flatMap((p) => p.dropoffs) ?? [];

  // Rows are direct children of the scroll view so each day's title can stick to the top until the next one pushes it off.
  const rows: ReactElement[] = [];
  const sticky: number[] = [];
  list.forEach((d, i) => {
    const badge = OWNER_BADGE[d.status];
    const next = list[i + 1];
    if (i === 0 || groupKey(list[i - 1]) !== groupKey(d)) {
      // Only completed drop offs count toward the day's laundry fee.
      const laundryTotal = list
        .filter((o) => o.status === 'completed' && groupKey(o) === groupKey(d))
        .reduce((sum, o) => sum + (o.laundry_fee ?? 0), 0);
      sticky.push(rows.length);
      rows.push(
        <View key={`day-${groupKey(d)}`} testID="dropoff-day" style={[styles.groupTitle, { backgroundColor: theme.background }]}>
          <ThemedText style={[styles.groupTitleText, styles.grow]}>{dayLabel(d.updated_at)}</ThemedText>
          {d.status === 'completed' && (
            <View style={styles.groupTotal}>
              <ThemedText style={[styles.groupTitleText, { color: theme.primary }]}>{peso(laundryTotal)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                laundry fee
              </ThemedText>
            </View>
          )}
        </View>,
      );
    }
    rows.push(
      <Card key={d.id} onPress={() => router.push({ pathname: '/owner/dropoff/[id]', params: { id: String(d.id) } })}>
        <View style={styles.header}>
          {/* Same figure as the summary's "Total to pay the shop". */}
          <ThemedText type="smallBold" style={styles.title}>
            {peso(d.total_delivery_fee + (d.laundry_fee ?? 0))}
          </ThemedText>
          {badge && <StatusBadge label={badge.label} tone={badge.tone} />}
        </View>
        <ThemedText type="smallBold">
          {d.customer_name} · {d.weight_kg} kg · laundry {peso(d.laundry_fee ?? 0)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {d.store_name} · {DROPOFF_STATUS_LABEL[d.status]}
        </ThemedText>
      </Card>,
    );
    // Line between badge groups.
    if (next && OWNER_BADGE[next.status]?.label !== badge?.label) {
      rows.push(<View key={`line-${d.id}`} style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />);
    }
  });

  // The fixed rows above the list, null ones dropped so `sticky` indexes line up with the scroll view's children.
  const top = [
    <ThemedText key="title" type="subtitle">
      Drop offs
    </ThemedText>,
    dropoffs.isPending && <ActivityIndicator key="loading" />,
    <ErrorText key="error" error={dropoffs.error} />,
    dropoffs.isSuccess && list.length === 0 && (
      <ThemedText key="empty" themeColor="textSecondary">
        No drop offs yet. Pull down to refresh.
      </ThemedText>
    ),
  ].filter((row): row is ReactElement => Boolean(row));

  return (
    <Screen onRefresh={dropoffs.refresh} stickyHeaderIndices={sticky.map((i) => i + top.length)}>
      {top}
      {rows}
      {dropoffs.hasNextPage && (
        <Button title="See More" variant="secondary" loading={dropoffs.isFetchingNextPage} onPress={() => dropoffs.fetchNextPage()} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  groupTitleText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  grow: { flex: 1 },
  groupTotal: { alignItems: 'flex-end' },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { flex: 1 },
});
