import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DriverDetails } from '@/components/driver-details';
import { DropoffMap, PinColor, type MapPin } from '@/components/dropoff-map';
import { DropoffSummary } from '@/components/dropoff-summary';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { VehicleRow } from '@/components/vehicle-row';
import { Spacing } from '@/constants/theme';
import { useCreateDropoff, useDropoff, useDropoffAction, useRoadRoute } from '@/hooks/queries';
import { useSocket } from '@/hooks/use-socket';
import { DROPOFF_STATUS_LABEL, peso } from '@/lib/format';
import type { DropoffStatus, LatLng, NearbyDriver } from '@/lib/types';

const DISPATCH: DropoffStatus[] = ['searching', 'driver_accepted'];
const TRACKING: DropoffStatus[] = ['en_route_pickup', 'en_route_shop'];
const AT_SHOP: DropoffStatus[] = ['dropped_off', 'owner_confirmed', 'payment_pending', 'completed'];

export default function DropoffDetail() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const live = useRef(false);
  const dropoff = useDropoff(id, () => live.current);
  const action = useDropoffAction(id);
  const again = useCreateDropoff();
  const [drivers, setDrivers] = useState<NearbyDriver[]>([]);
  const [driverAt, setDriverAt] = useState<LatLng | null>(null);
  const [stale, setStale] = useState(false);

  const d = dropoff.data;
  const room = !d ? null : DISPATCH.includes(d.status) ? 'dispatch' : TRACKING.includes(d.status) ? (d.room_id ?? null) : null;
  const { connected } = useSocket(room, (msg) => {
    if (msg.t === 'drivers') setDrivers(msg.items);
    else if (msg.t === 'loc') {
      setDriverAt({ lat: msg.lat, lng: msg.lng });
      setStale(false);
    } else if (msg.t === 'stale') setStale(true);
    else dropoff.refetch();
  });
  // Status changes arrive over the socket; polling only backs it up.
  useEffect(() => {
    live.current = connected;
  });
  // Pins are fixed once booked, so the road from the customer to the shop is fetched once.
  const route = useRoadRoute(d ? { lat: d.customer_lat, lng: d.customer_lng } : null, d ? { lat: d.shop_lat, lng: d.shop_lng } : null);

  if (!d) {
    return <Screen edges={[]}>{dropoff.isPending ? <ActivityIndicator /> : <ErrorText error={dropoff.error} />}</Screen>;
  }

  const customer = { lat: d.customer_lat, lng: d.customer_lng };
  const pins: MapPin[] = [
    { key: 'customer', at: customer, title: 'You', color: PinColor.customer, icon: 'person' },
    { key: 'shop', at: { lat: d.shop_lat, lng: d.shop_lng }, title: d.store_name, color: PinColor.shop, icon: 'store' },
  ];
  const run = (a: Parameters<typeof action.mutate>[0]) => action.mutate(a);
  const footer = (() => {
    switch (d.status) {
      case 'searching':
        return <Button title="Cancel" variant="secondary" loading={action.isPending} onPress={() => run({ action: 'cancel' })} />;
      case 'driver_accepted':
        return (
          <>
            <Button title="Confirm driver" loading={action.isPending} onPress={() => run({ action: 'confirm-driver' })} />
            <Button title="Find another driver" variant="secondary" onPress={() => run({ action: 'reject-driver' })} />
            <Button title="Cancel drop off" variant="outline" onPress={() => run({ action: 'cancel' })} />
          </>
        );
      case 'en_route_pickup':
        return <Button title="Cancel drop off" variant="danger" loading={action.isPending} onPress={() => run({ action: 'cancel' })} />;
      case 'owner_confirmed':
      case 'payment_pending':
        return <Button title="Done Pay" loading={action.isPending} onPress={() => run({ action: 'payment', body: { paid: true } })} />;
      case 'expired':
      case 'cancelled':
        return (
          <Button
            title="Search again"
            loading={again.isPending}
            onPress={() =>
              again.mutate(
                { store_id: d.store_id, lat: d.customer_lat, lng: d.customer_lng, address: d.customer_address },
                { onSuccess: (next) => router.replace({ pathname: '/customer/dropoff/[id]', params: { id: String(next.id) } }) },
              )
            }
          />
        );
      default:
        return undefined;
    }
  })();

  const error = action.error ?? again.error;

  return (
    <Screen
      edges={[]}
      onRefresh={dropoff.refetch}
      footer={
        footer && (
          <>
            {/* Beside the buttons that cause it, so a failed tap is never off-screen. */}
            <ErrorText error={error} />
            {footer}
          </>
        )
      }>
      <ThemedText type="subtitle">{DROPOFF_STATUS_LABEL[d.status]}</ThemedText>

      {d.status === 'searching' && (
        <>
          <View style={styles.mapCard}>
            <DropoffMap
              center={customer}
              path={route.data?.path}
              pins={[
                ...pins,
                ...drivers.map((x, i) => ({ key: `driver-${i}`, at: x, color: x.colour === 'green' ? PinColor.near : PinColor.far, icon: 'motorcycle' as const })),
              ]}
            />
          </View>
          <ThemedText themeColor="textSecondary">
            {drivers.length > 0
              ? `${drivers.length} driver${drivers.length > 1 ? 's' : ''} nearby. Green is within 10 km, amber 10–20 km.`
              : 'Looking for drivers near you…'}
          </ThemedText>
          <FeeRow fee={d.total_delivery_fee} vehicle={d.vehicle_type} />
        </>
      )}

      {d.status === 'driver_accepted' && (
        <>
          <Card>
            <ThemedText type="smallBold">{d.driver_name} accepted your drop off</ThemedText>
            <DriverDetails driver={d} photoPath={`/dropoffs/${d.id}/driver-photo`} />
          </Card>
          <FeeRow fee={d.total_delivery_fee} vehicle={d.vehicle_type} />
        </>
      )}

      {TRACKING.includes(d.status) && (
        <>
          <View style={styles.mapCard}>
            <DropoffMap
              center={driverAt ?? customer}
              path={route.data?.path}
              pins={[...pins, ...(driverAt ? [{ key: 'driver', at: driverAt, title: d.driver_name ?? 'Driver', color: PinColor.driver, icon: 'motorcycle' as const }] : [])]}
            />
          </View>
          {stale && <ThemedText themeColor="textSecondary">The driver&apos;s location hasn&apos;t updated for 2 minutes.</ThemedText>}
          <Card>
            <View style={styles.row}>
              <Avatar name={d.driver_name ?? ''} />
              <View style={styles.grow}>
                <ThemedText type="smallBold">{d.driver_name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {d.driver_phone}
                </ThemedText>
              </View>
            </View>
          </Card>
        </>
      )}

      {AT_SHOP.includes(d.status) && <DropoffSummary dropoff={d} />}
      {!footer && <ErrorText error={error} />}
    </Screen>
  );
}

/** The booked vehicle and its delivery fee, before the drop off reaches the shop. */
function FeeRow({ fee, vehicle }: { fee: number; vehicle: number }) {
  return (
    <Card>
      <VehicleRow code={vehicle} />
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          Delivery fee
        </ThemedText>
        <ThemedText type="smallBold">{peso(fee)}</ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  mapCard: { borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
});
