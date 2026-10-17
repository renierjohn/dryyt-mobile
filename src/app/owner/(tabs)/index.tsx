import { router } from 'expo-router';
import { Fragment } from 'react';
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
import { DROPOFF_STATUS_LABEL, peso } from '@/lib/format';
import type { DropoffStatus } from '@/lib/types';

/** The owner's view of where a drop off stands; the worker only lists these statuses, sorted Not Yet Paid → Pending → Complete. */
const OWNER_BADGE: Partial<Record<DropoffStatus, { label: string; tone: Tone }>> = {
  dropped_off: { label: 'Pending', tone: 'warning' },
  owner_confirmed: { label: 'Pending', tone: 'warning' },
  completed: { label: 'Complete', tone: 'success' },
  payment_pending: { label: 'Not Yet Paid', tone: 'danger' },
};

export default function OwnerDropoffs() {
  const theme = useTheme();
  const dropoffs = useOwnerDropoffs();
  // The worker already sorts by badge group, then newest; 10 per page.
  const list = dropoffs.data?.pages.flatMap((p) => p.dropoffs) ?? [];

  return (
    <Screen onRefresh={dropoffs.refetch}>
      <ThemedText type="subtitle">Drop offs</ThemedText>
      {dropoffs.isPending && <ActivityIndicator />}
      <ErrorText error={dropoffs.error} />
      {dropoffs.isSuccess && list.length === 0 && <ThemedText themeColor="textSecondary">No drop offs yet. This list refreshes automatically.</ThemedText>}
      {list.map((d, i) => {
        const badge = OWNER_BADGE[d.status];
        const next = list[i + 1];
        return (
          <Fragment key={d.id}>
            <Card onPress={() => router.push({ pathname: '/owner/dropoff/[id]', params: { id: String(d.id) } })}>
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
            </Card>
            {/* Line between badge groups. */}
            {next && OWNER_BADGE[next.status]?.label !== badge?.label && (
              <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />
            )}
          </Fragment>
        );
      })}
      {dropoffs.hasNextPage && (
        <Button title="See More" variant="secondary" loading={dropoffs.isFetchingNextPage} onPress={() => dropoffs.fetchNextPage()} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  title: { flex: 1 },
});
