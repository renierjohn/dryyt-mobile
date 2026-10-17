import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { StatusBadge, type Tone } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCancelOrder, useOrder } from '@/hooks/queries';
import { STATUS_LABEL } from '@/lib/format';

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
  const tone: Tone = o.status === 'delivered' ? 'success' : o.status === 'cancelled' ? 'danger' : 'info';
  return (
    <Screen edges={[]} onRefresh={order.refetch}>
      <Card>
        <View style={styles.statusRow}>
          <ThemedText type="smallBold" style={styles.grow}>
            Order #{o.id}
          </ThemedText>
          <StatusBadge label={STATUS_LABEL[o.status]} tone={tone} />
        </View>
        <StatusTimeline status={o.status} />
      </Card>
      <Card>
        <OrderSummary order={o} />
      </Card>
      {o.driver_name && (
        <Card>
          <View style={styles.statusRow}>
            <Avatar name={o.driver_name} />
            <View style={styles.grow}>
              <ThemedText type="smallBold">{o.driver_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {o.driver_phone}
              </ThemedText>
            </View>
          </View>
        </Card>
      )}
      <ErrorText error={cancel.error} />
      {o.status === 'pending' && (
        <Button title="Cancel order" variant="danger" onPress={() => cancel.mutate()} loading={cancel.isPending} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
});
