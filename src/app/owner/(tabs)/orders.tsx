import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useConfirmPayment, useOwnerOrders } from '@/hooks/queries';
import { apiUrl, authHeaders } from '@/lib/api';

export default function Orders() {
  const orders = useOwnerOrders();
  const confirm = useConfirmPayment();
  // The worker already sorts: newest first.
  const list = orders.data?.pages.flatMap((p) => p.orders) ?? [];

  return (
    <Screen onRefresh={orders.refetch}>
      <ThemedText type="subtitle">Orders</ThemedText>
      {orders.isPending && <ActivityIndicator />}
      <ErrorText error={orders.error ?? confirm.error} />
      {orders.isSuccess && list.length === 0 && <ThemedText themeColor="textSecondary">No orders yet.</ThemedText>}
      {list.map((o) => (
        <Card key={o.id}>
          <OrderSummary order={o} />
          {o.payment_ref ? <ThemedText type="small">Reference no.: {o.payment_ref}</ThemedText> : null}
          {o.payment_photo_key && (
            <Image
              testID={`payment-photo-${o.id}`}
              source={{ uri: apiUrl(`/owner/orders/${o.id}/payment-photo`), headers: authHeaders() }}
              style={styles.photo}
              contentFit="contain"
            />
          )}
          {o.status === 'awaiting_payment' && (
            <Button title="Done Pay" loading={confirm.isPending && confirm.variables === o.id} onPress={() => confirm.mutate(o.id)} />
          )}
        </Card>
      ))}
      {orders.hasNextPage && (
        <Button title="Show More" variant="secondary" loading={orders.isFetchingNextPage} onPress={() => orders.fetchNextPage()} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 280, borderRadius: 12 },
});
