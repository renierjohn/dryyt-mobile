import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DropoffPaymentProof } from '@/components/dropoff-payment-proof';
import { DropoffSummary } from '@/components/dropoff-summary';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useBlockDriver, useDropoff, useDropoffAction, useOwnerConfirm } from '@/hooks/queries';
import { DROPOFF_STATUS_LABEL } from '@/lib/format';

export default function OwnerDropoff() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  // Every status change the owner cares about also comes as a push, which refetches this; poll only as a fallback.
  const dropoff = useDropoff(id, () => true);
  const confirm = useOwnerConfirm();
  const payment = useDropoffAction(id);
  const block = useBlockDriver();
  const d = dropoff.data;

  if (!d) {
    return <Screen edges={[]}>{dropoff.isPending ? <ActivityIndicator /> : <ErrorText error={dropoff.error} />}</Screen>;
  }

  return (
    <Screen edges={[]} onRefresh={dropoff.refetch}>
      <ThemedText type="subtitle">{DROPOFF_STATUS_LABEL[d.status]}</ThemedText>
      <DropoffSummary dropoff={d} />
      <Card>
        <ThemedText type="small">
          Customer: {d.customer_name} · {d.customer_phone}
        </ThemedText>
        <ThemedText type="small">
          Driver: {d.driver_name} · {d.driver_phone}
        </ThemedText>
      </Card>
      <DropoffPaymentProof dropoff={d} title="Customer's proof of payment" />
      <ErrorText error={confirm.error ?? payment.error ?? block.error} />
      {d.status === 'dropped_off' && <Button title="Confirm received" loading={confirm.isPending} onPress={() => confirm.mutate(id)} />}
      {(d.status === 'owner_confirmed' || d.status === 'payment_pending') && (
        <Button title="Customer paid" loading={payment.isPending} onPress={() => payment.mutate({ action: 'payment', body: { paid: true } })} />
      )}
      {(d.status === 'owner_confirmed' || d.status === 'completed') && (
        <Button title="Not paid yet" variant="secondary" onPress={() => payment.mutate({ action: 'payment', body: { paid: false } })} />
      )}
      {d.driver_id !== null && (
        <Button
          title={block.data?.blocked ? 'Driver blocked' : 'Block this driver'}
          variant="danger"
          disabled={block.data?.blocked === true || d.status === 'completed'}
          loading={block.isPending}
          onPress={() => block.mutate({ driver_id: d.driver_id!, blocked: true, store_id: d.store_id })}
        />
      )}
    </Screen>
  );
}
