import { router } from 'expo-router';
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
import { useAcceptJob, useActiveJob, useAvailableJobs, useDriverMe, useSavedOnline, useSetOnline } from '@/hooks/queries';
import { useNewJobSound } from '@/hooks/use-new-job-sound';

export default function AvailableJobs() {
  const jobs = useAvailableJobs();
  useNewJobSound((jobs.data ?? []).map((j) => `order-${j.id}`));
  const active = useActiveJob();
  const accept = useAcceptJob();
  const me = useDriverMe();
  const setOnline = useSetOnline();
  const saved = useSavedOnline();
  // Server value once it answers, the phone's saved copy before that; the requested value while saving.
  const online = setOnline.isPending ? setOnline.variables : (me.data?.driver.online ?? saved.data ?? false);
  const job = me.data?.job ?? null;
  const onDropoff = job !== null && job.status !== 'dropped_off';
  const busy = Boolean(active.data) || onDropoff;

  return (
    <Screen onRefresh={PICKUP_ENABLED ? jobs.refetch : me.refetch}>
      <ThemedText type="subtitle">Available jobs</ThemedText>
      <Card>
        <View style={styles.row}>
          <ThemedText type="smallBold">Online for drop offs</ThemedText>
          <Switch value={online} disabled={setOnline.isPending} onValueChange={(v) => setOnline.mutate(v)} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Keep Dryyt open while online so customers can see you.
        </ThemedText>
      </Card>
      {online && !active.data && (!job || job.status === 'driver_accepted' || job.status === 'dropped_off') && (
        <DropoffRequests acceptedAt={job?.status === 'driver_accepted' ? job.updated_at : null} />
      )}
      {job && job.status !== 'driver_accepted' && job.status !== 'dropped_off' && (
        <ThemedText themeColor="textSecondary">You have an active drop off. Open the Active tab.</ThemedText>
      )}
      {PICKUP_ENABLED && (
        <>
          <ThemedText type="smallBold">Pickup jobs</ThemedText>
          {busy && <ThemedText themeColor="textSecondary">Finish your active job before accepting another.</ThemedText>}
          {jobs.isPending && <ActivityIndicator />}
          <ErrorText error={jobs.error ?? accept.error} />
          {jobs.data?.length === 0 && (
            <ThemedText themeColor="textSecondary">No jobs right now. This list refreshes automatically.</ThemedText>
          )}
          {jobs.data?.map((job) => (
            <Card key={job.id}>
              <OrderSummary order={job} />
              <Button
                title="Accept job"
                disabled={busy}
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
});
