import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { DropoffTrip } from '@/components/driver/dropoff-trip';
import { PICKUP_ENABLED } from '@/constants/features';
import { OrderSummary } from '@/components/order-summary';
import { OrderTripMap } from '@/components/order-trip-map';
import { Screen } from '@/components/screen';
import { StatusTimeline } from '@/components/status-timeline';
import { ThemedText } from '@/components/themed-text';
import { useActiveJob, useAdvanceJob, useDriverMe, useReleaseJob } from '@/hooks/queries';
import { useWatchLocation } from '@/hooks/use-location';
import { useSocket } from '@/hooks/use-socket';
import { distanceMeters } from '@/lib/geo';
import type { LatLng, OrderDetail } from '@/lib/types';

/** The driver must be this close to the customer's pin before Delivered unlocks; same rule as drop off pickups. */
const ARRIVE_METERS = 200;

/** "350 m from the customer. Get within 200 m to deliver." */
function deliverText(meters: number) {
  const far = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  return `${far} from the customer. Get within ${ARRIVE_METERS} m to deliver.`;
}

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
  const qc = useQueryClient();
  const live = useRef(false);
  const active = useActiveJob(false, () => live.current);
  const advance = useAdvanceJob();
  const release = useReleaseJob();
  const job = active.data;
  const [here, setHere] = useState<LatLng | null>(null);
  // The order's room while the job is ours: status changes arrive here (e.g. the customer cancels).
  const { connected, send } = useSocket(
    job ? `order-${job.id}` : null,
    (msg) => {
      if (msg.t !== 'order') return;
      const mine = msg.order.status === 'accepted' || msg.order.status === 'picked_up';
      qc.setQueryData(['jobs', 'active'], mine ? msg.order : null);
      // Ended (delivered or cancelled): the Available screen's busy check reads /drivers/me.
      if (!mine) qc.invalidateQueries({ queryKey: ['driver'] });
    },
    // Resend the latest fix on (re)connect so the customer sees the driver without waiting for the next one.
    (sendNow) => {
      if (here && job?.status === 'picked_up') sendNow({ t: 'loc', ...here });
    },
  );
  useEffect(() => {
    live.current = connected;
  });
  // Once picked up, the customer follows the driver on their order's map.
  const carrying = job?.status === 'picked_up';
  useWatchLocation(carrying, (at) => {
    setHere(at);
    send({ t: 'loc', ...at });
  });

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
  // Straight-line distance on the phone, no request. Typed-address orders have no pin to check against.
  const customer = job.customer_lat !== null && job.customer_lng !== null ? { lat: job.customer_lat, lng: job.customer_lng } : null;
  const toCustomer = customer && here ? distanceMeters(here, customer) : null;
  const canDeliver = !customer || (toCustomer !== null && toCustomer < ARRIVE_METERS);
  return (
    <Screen onRefresh={active.refetch}>
      <ThemedText type="subtitle">Active job</ThemedText>
      <StatusTimeline status={job.status} />
      {carrying && <OrderTripMap order={job} driverAt={here} />}
      <Card>
        <OrderSummary order={job} showFees orderTotal />
      </Card>
      <Card>
        <ThemedText type="smallBold">Customer</ThemedText>
        <ThemedText type="small">
          {job.customer_name} · {job.customer_phone}
        </ThemedText>
      </Card>
      <ErrorText error={advance.error ?? release.error} />
      {carrying && customer && (
        <ThemedText themeColor="textSecondary">
          {toCustomer === null ? 'Waiting for your location…' : canDeliver ? 'You are at the customer.' : deliverText(toCustomer)}
        </ThemedText>
      )}
      {step && (
        <Button
          title={step.label}
          onPress={() => advance.mutate({ id: job.id, status: step.status })}
          loading={advance.isPending}
          disabled={step.status === 'delivered' && !canDeliver}
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
  // Only decides which screen to show; PickupJob polls (or listens) for the job itself.
  const pickup = useActiveJob(onTrip, () => true);
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
