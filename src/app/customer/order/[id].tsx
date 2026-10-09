import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { useCancelOrder, useOrder } from '@/hooks/queries';

export default function OrderScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const order = useOrder(id);
  const cancel = useCancelOrder(id);

  if (order.isPending) {
    return (
      <Screen edges={[]}>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (order.isError) {
    return (
      <Screen edges={[]}>
        <ErrorText error={order.error} />
      </Screen>
    );
  }

  const o = order.data;
  return (
    <Screen edges={[]} onRefresh={order.refetch}>
      <StatusTimeline status={o.status} />
      <Card>
        <OrderSummary order={o} />
      </Card>
      {o.driver_name && (
        <Card>
          <ThemedText type="smallBold">Driver</ThemedText>
          <ThemedText type="small">
            {o.driver_name} · {o.driver_phone}
          </ThemedText>
        </Card>
      )}
      <ErrorText error={cancel.error} />
      {o.status === 'pending' && (
        <Button title="Cancel order" variant="danger" onPress={() => cancel.mutate()} loading={cancel.isPending} />
      )}
    </Screen>
  );
}
