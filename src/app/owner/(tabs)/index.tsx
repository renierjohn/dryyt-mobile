import { router } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useOwnerDropoffs } from '@/hooks/queries';
import { DROPOFF_STATUS_LABEL, peso } from '@/lib/format';

export default function OwnerDropoffs() {
  const dropoffs = useOwnerDropoffs();
  // The worker already sorts: waiting for confirmation first, then newest.
  const list = dropoffs.data?.pages.flatMap((p) => p.dropoffs) ?? [];

  return (
    <Screen onRefresh={dropoffs.refetch}>
      <ThemedText type="subtitle">Drop offs</ThemedText>
      {dropoffs.isPending && <ActivityIndicator />}
      <ErrorText error={dropoffs.error} />
      {dropoffs.isSuccess && list.length === 0 && <ThemedText themeColor="textSecondary">No drop offs yet. This list refreshes automatically.</ThemedText>}
      {list.map((d) => (
        <Card key={d.id} onPress={() => router.push({ pathname: '/owner/dropoff/[id]', params: { id: String(d.id) } })}>
          <ThemedText type="smallBold">
            {d.customer_name} · {d.weight_kg} kg
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {d.store_name} · {DROPOFF_STATUS_LABEL[d.status]} · laundry {peso(d.laundry_fee ?? 0)}
          </ThemedText>
        </Card>
      ))}
      {dropoffs.hasNextPage && (
        <Button title="Show More" variant="secondary" loading={dropoffs.isFetchingNextPage} onPress={() => dropoffs.fetchNextPage()} />
      )}
    </Screen>
  );
}
