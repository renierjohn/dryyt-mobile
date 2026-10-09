import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DriverDetails } from '@/components/driver-details';
import { DropoffMap, PinColor, type MapPin } from '@/components/dropoff-map';
import { DropoffSummary } from '@/components/dropoff-summary';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useCreateDropoff, useDropoff, useDropoffAction } from '@/hooks/queries';
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

  if (!d) {
    return <Screen edges={[]}>{dropoff.isPending ? <ActivityIndicator /> : <ErrorText error={dropoff.error} />}</Screen>;
  }

  const customer = { lat: d.customer_lat, lng: d.customer_lng };
  const pins: MapPin[] = [
    { key: 'customer', at: customer, title: 'You', color: PinColor.customer, icon: 'person' },
    { key: 'shop', at: { lat: d.shop_lat, lng: d.shop_lng }, title: d.store_name, color: PinColor.shop, icon: 'store' },
  ];
  const run = (a: Parameters<typeof action.mutate>[0]) => action.mutate(a);

  return (
    <Screen edges={[]} onRefresh={dropoff.refetch}>
      <ThemedText type="subtitle">{DROPOFF_STATUS_LABEL[d.status]}</ThemedText>

      {d.status === 'searching' && (
        <>
          <DropoffMap
            center={customer}
            pins={[
              ...pins,
              ...drivers.map((x, i) => ({ key: `driver-${i}`, at: x, color: x.colour === 'green' ? PinColor.near : PinColor.far, icon: 'motorcycle' as const })),
            ]}
          />
          <ThemedText themeColor="textSecondary">
            {drivers.length > 0
              ? `${drivers.length} driver${drivers.length > 1 ? 's' : ''} nearby. Green is within 10 km, amber 10–20 km.`
              : 'Looking for drivers near you…'}
          </ThemedText>
          <ThemedText>Delivery fee: {peso(d.total_delivery_fee)}</ThemedText>
          <Button title="Cancel" variant="secondary" loading={action.isPending} onPress={() => run({ action: 'cancel' })} />
        </>
      )}

      {d.status === 'driver_accepted' && (
        <Card>
          <ThemedText type="smallBold">{d.driver_name} accepted your drop off</ThemedText>
          <DriverDetails dropoff={d} />
          <ThemedText>Delivery fee: {peso(d.total_delivery_fee)}</ThemedText>
          <Button title="Confirm driver" loading={action.isPending} onPress={() => run({ action: 'confirm-driver' })} />
          <Button title="Find another driver" variant="secondary" onPress={() => run({ action: 'reject-driver' })} />
          <Button title="Cancel drop off" variant="danger" onPress={() => run({ action: 'cancel' })} />
        </Card>
      )}

      {TRACKING.includes(d.status) && (
        <>
          <DropoffMap
            center={driverAt ?? customer}
            pins={[...pins, ...(driverAt ? [{ key: 'driver', at: driverAt, title: d.driver_name ?? 'Driver', color: PinColor.driver, icon: 'motorcycle' as const }] : [])]}
          />
          {stale && <ThemedText themeColor="textSecondary">The driver&apos;s location hasn&apos;t updated for 2 minutes.</ThemedText>}
          <ThemedText>
            {d.driver_name} · {d.driver_phone}
          </ThemedText>
          {d.status === 'en_route_pickup' && (
            <Button title="Cancel drop off" variant="danger" loading={action.isPending} onPress={() => run({ action: 'cancel' })} />
          )}
        </>
      )}

      {AT_SHOP.includes(d.status) && <DropoffSummary dropoff={d} />}
      {(d.status === 'owner_confirmed' || d.status === 'payment_pending') && (
        <Button title="Done Pay" loading={action.isPending} onPress={() => run({ action: 'payment', body: { paid: true } })} />
      )}

      {(d.status === 'expired' || d.status === 'cancelled') && (
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
      )}
      <ErrorText error={action.error ?? again.error} />
    </Screen>
  );
}
