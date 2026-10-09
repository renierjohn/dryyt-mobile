import { useRef } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { DropoffTrip } from '@/components/driver/dropoff-trip';
import { PICKUP_ENABLED } from '@/constants/features';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { useActiveJob, useAdvanceJob, useDriverMe, useReleaseJob } from '@/hooks/queries';
import type { OrderDetail } from '@/lib/types';

function nextStep(job: OrderDetail) {
  if (job.status === 'accepted') {
    return {
      status: 'picked_up' as const,
      label: `Picked up at ${job.store_name}`,
    };
  }
  if (job.status === 'picked_up') {
    return {
      status: 'delivered' as const,
      label: 'Delivered to customer',
    };
  }
  return null;
}

function PickupJob() {
  const active = useActiveJob();
  const advance = useAdvanceJob();
  const release = useReleaseJob();
  const job = active.data;

  if (active.isPending) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!job) {
    return (
      <Screen onRefresh={active.refetch}>
        <ThemedText type="subtitle">Active job</ThemedText>
        <ErrorText error={active.error} />
        <ThemedText themeColor="textSecondary">No active job. Accept one from Available.</ThemedText>
      </Screen>
    );
  }

  const step = nextStep(job);
  return (
    <Screen onRefresh={active.refetch}>
      <ThemedText type="subtitle">Active job</ThemedText>
      <StatusTimeline status={job.status} />
      <Card>
        <OrderSummary order={job} />
      </Card>
      <Card>
        <ThemedText type="smallBold">Customer</ThemedText>
        <ThemedText type="small">
          {job.customer_name} · {job.customer_phone}
        </ThemedText>
      </Card>
      <ErrorText error={advance.error ?? release.error} />
      {step && (
        <Button
          title={step.label}
          onPress={() => advance.mutate({ id: job.id, status: step.status })}
          loading={advance.isPending}
        />
      )}
      {job.status === 'accepted' && (
        <Button
          title="Release job"
          variant="secondary"
          onPress={() => release.mutate(job.id)}
          loading={release.isPending}
        />
      )}
    </Screen>
  );
}

export default function ActiveJob() {
  const live = useRef(false);
  const me = useDriverMe(() => live.current);
  const job = me.data?.job;
  const onTrip = job?.status === 'en_route_pickup' || job?.status === 'en_route_shop';
  const pickup = useActiveJob(onTrip);
  if (job && (onTrip || (job.status === 'dropped_off' && !pickup.data))) {
    return <DropoffTrip job={job} onLive={(connected) => (live.current = connected)} />;
  }
  if (!PICKUP_ENABLED) {
    return (
      <Screen onRefresh={me.refetch}>
        <ThemedText type="subtitle">Active job</ThemedText>
        <ErrorText error={me.error} />
        <ThemedText themeColor="textSecondary">No active drop off. Accept one from Available.</ThemedText>
      </Screen>
    );
  }
  return <PickupJob />;
}
