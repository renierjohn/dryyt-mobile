import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useMarkPayoutPaid, usePayouts } from '@/hooks/queries';
import { peso } from '@/lib/format';

export default function Payouts() {
  const payouts = usePayouts();
  const markPaid = useMarkPayoutPaid();
  // The worker already sorts: pending first, then newest.
  const list = payouts.data?.pages.flatMap((p) => p.payouts) ?? [];

  return (
    <Screen onRefresh={payouts.refetch}>
      <ThemedText type="subtitle">Payouts</ThemedText>
      {payouts.isPending && <ActivityIndicator />}
      <ErrorText error={payouts.error ?? markPaid.error} />
      {payouts.isSuccess && list.length === 0 && <ThemedText themeColor="textSecondary">Nothing to pay yet.</ThemedText>}
      {list.map((p) => (
        <Card key={p.id}>
          <ThemedText type="smallBold">
            {p.payee_type === 'driver' ? `Driver ${p.payee_name ?? ''}` : 'App service fee'} · {peso(p.amount)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {p.store_name} · Drop off #{p.transaction_id} · {p.status === 'paid' ? `paid ${p.paid_at}` : 'pending'}
          </ThemedText>
          {p.status === 'pending' && (
            <Button title="Mark paid" loading={markPaid.isPending && markPaid.variables === p.id} onPress={() => markPaid.mutate(p.id)} />
          )}
        </Card>
      ))}
      {payouts.hasNextPage && (
        <Button title="Show More" variant="secondary" loading={payouts.isFetchingNextPage} onPress={() => payouts.fetchNextPage()} />
      )}
    </Screen>
  );
}
