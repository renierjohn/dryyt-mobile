import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { DropoffRequests } from '@/components/driver/dropoff-requests';
import { OrderSummary } from '@/components/order-summary';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PICKUP_ENABLED } from '@/constants/features';
import { Spacing } from '@/constants/theme';
import { useAcceptJob, useAvailableJobs, useDriverMe, useSavedOnline, useSetOnline, useSetPickupOnline } from '@/hooks/queries';
import { useNewJobSound } from '@/hooks/use-new-job-sound';
import { useSocket } from '@/hooks/use-socket';
import { useTheme } from '@/hooks/use-theme';
import type { Order } from '@/lib/types';

export default function AvailableJobs() {
  const qc = useQueryClient();
  const theme = useTheme();
  // Dispatch or the job board is connected: they push every change to the driver's state, so polling is a slow fallback.
  const dispatchLive = useRef(false);
  const live = useRef(false);
  const me = useDriverMe(() => dispatchLive.current || live.current);
  const setPickupOnline = useSetPickupOnline();
  // Unverified drivers can't go online or accept jobs (the server refuses too). Unknown until /drivers/me answers.
  const verified = me.data?.driver.verified ?? false;
  // The requested value while saving.
  const pickupOnline = PICKUP_ENABLED && verified && (setPickupOnline.isPending ? setPickupOnline.variables : (me.data?.driver.pickup_online ?? false));
  const jobs = useAvailableJobs(pickupOnline, () => live.current);
  // Online for pickup: the job board pushes every change instead of polling.
  const { connected } = useSocket(pickupOnline && me.data?.driver.pickup_online ? 'pickups' : null, (msg) => {
    if (msg.t === 'jobs') qc.setQueryData<Order[]>(['jobs', 'available'], msg.jobs);
  });
  useEffect(() => {
    live.current = connected;
  });
  useNewJobSound(pickupOnline ? (jobs.data ?? []).map((j) => `order-${j.id}`) : []);
  const accept = useAcceptJob();
  const setOnline = useSetOnline();
  const saved = useSavedOnline();
  // Server value once it answers, the phone's saved copy before that; the requested value while saving.
  const online = verified && (setOnline.isPending ? setOnline.variables : (me.data?.driver.online ?? saved.data ?? false));
  const job = me.data?.job ?? null;
  const onDropoff = job !== null && job.status !== 'dropped_off';
  const onPickup = (me.data?.driver.pickup_job_id ?? null) !== null;
  const busy = onPickup || onDropoff;

  return (
    <Screen onRefresh={() => Promise.all([me.refetch(), pickupOnline && jobs.refetch()])}>
      <ThemedText type="subtitle">Available jobs</ThemedText>
      {me.data && !verified && (
        <Card>
          <ThemedText type="smallBold">Get verified to take jobs</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Add your face photo, license, plate number and vehicle in Profile. You can go online once an admin verifies you.
          </ThemedText>
          <Button title="Open Profile" variant="secondary" onPress={() => router.navigate('/driver/profile')} />
        </Card>
      )}
      <Card>
        <View style={styles.row}>
          <ThemedText type="smallBold">Online for drop offs</ThemedText>
          <Switch value={online} disabled={!verified || setOnline.isPending} onValueChange={(v) => (verified ? setOnline.mutate(v) : undefined)} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Keep Dryyt open while online so customers can see you.
        </ThemedText>
      </Card>
      <ErrorText error={setOnline.error} />
      {online && !onPickup && (!job || job.status === 'driver_accepted' || job.status === 'dropped_off') && (
        <DropoffRequests acceptedAt={job?.status === 'driver_accepted' ? job.updated_at : null} onLive={(c) => (dispatchLive.current = c)} />
      )}
      {job && job.status !== 'driver_accepted' && job.status !== 'dropped_off' && (
        <ThemedText themeColor="textSecondary">You have an active drop off. Open the Active tab.</ThemedText>
      )}
      {PICKUP_ENABLED && (
        <>
          <View testID="pickup-separator" style={[styles.separator, { backgroundColor: theme.border }]} />
          <Card>
            <View style={styles.row}>
              <ThemedText type="smallBold">Online for Pickup</ThemedText>
              <Switch
                value={pickupOnline}
                disabled={!verified || setPickupOnline.isPending}
                onValueChange={(v) => (verified ? setPickupOnline.mutate(v) : undefined)}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              New pickup jobs appear here as soon as customers place them.
            </ThemedText>
          </Card>
          <ErrorText error={setPickupOnline.error ?? accept.error} />
          {pickupOnline && (
            <>
              <ThemedText type="smallBold">Pickup jobs</ThemedText>
              {busy && <ThemedText themeColor="textSecondary">Finish your active job before accepting another.</ThemedText>}
              {jobs.isPending && <ActivityIndicator />}
              <ErrorText error={jobs.error} />
              {jobs.data?.length === 0 && <ThemedText themeColor="textSecondary">No Active Orders</ThemedText>}
            </>
          )}
          {pickupOnline && jobs.data?.map((job) => (
            <Card key={job.id}>
              <OrderSummary order={job} showFees youEarn />
              <Button
                title="Accept job"
                disabled={busy || !verified}
                loading={accept.isPending && accept.variables === job.id}
                onPress={() => accept.mutate(job.id, { onSuccess: () => router.navigate('/driver/active') })}
              />
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
});
