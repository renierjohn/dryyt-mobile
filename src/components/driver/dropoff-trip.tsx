import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DropForm } from '@/components/driver/drop-form';
import { DropoffMap, PinColor, type MapPin } from '@/components/dropoff-map';
import { DropoffSummary } from '@/components/dropoff-summary';
import { ErrorText } from '@/components/error-text';
import { JobChat, useJobChat } from '@/components/job-chat';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useDropoffAction } from '@/hooks/queries';
import { useWatchLocation } from '@/hooks/use-location';
import { useSocket } from '@/hooks/use-socket';
import { peso } from '@/lib/format';
import { distanceMeters } from '@/lib/geo';
import type { Dropoff, LatLng } from '@/lib/types';

/** The driver must be this close to the customer pin to pick up, and to the shop pin before the drop form opens. */
const ARRIVE_METERS = 200;

/** `onLive` reports whether the trip socket is connected, so the parent can slow its polling. */
/** "350 m from the customer. Get within 100 m to pick up." and friends. */
function nearText(meters: number | null, near: boolean, place: string, verb: string) {
  if (meters === null) return 'Waiting for your location…';
  if (near) return `You are at the ${place}.`;
  const far = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  return `${far} from the ${place}. Get within ${ARRIVE_METERS} m to ${verb}.`;
}

export function DropoffTrip({ job, onLive }: { job: Dropoff; onLive?: (connected: boolean) => void }) {
  const qc = useQueryClient();
  const action = useDropoffAction(job.id);
  const [here, setHere] = useState<LatLng | null>(null);
  const [arrived, setArrived] = useState(false);
  // null until the trip room says; only an offline customer lets the driver cancel.
  const [customerOnline, setCustomerOnline] = useState<boolean | null>(null);
  const tracking = job.status === 'en_route_pickup' || job.status === 'en_route_shop';

  const chat = useJobChat();
  const { connected, send } = useSocket(
    tracking ? (job.room_id ?? null) : null,
    (msg) => {
      if (chat.onMessage(msg)) return;
      if (msg.t === 'status') qc.invalidateQueries({ queryKey: ['driver'] });
      else if (msg.t === 'customer') setCustomerOnline(msg.online === true);
    },
    // Resend the latest fix on (re)connect so the customer sees the driver without waiting for the next one.
    (sendNow) => {
      if (here) sendNow({ t: 'loc', ...here });
    },
  );
  useEffect(() => {
    onLive?.(connected);
  }, [onLive, connected]);
  useWatchLocation(tracking, (at) => {
    setHere(at);
    send({ t: 'loc', ...at });
  });

  if (job.status === 'dropped_off') {
    return (
      <Screen>
        <ThemedText type="subtitle">Pending owner confirmation</ThemedText>
        <ThemedText themeColor="textSecondary">You can go online for the next job. The shop pays your delivery fee.</ThemedText>
        <DropoffSummary dropoff={job} />
      </Screen>
    );
  }

  const customer = { lat: job.customer_lat, lng: job.customer_lng };
  const shop = { lat: job.shop_lat, lng: job.shop_lng };
  const toCustomer = here ? distanceMeters(here, customer) : null;
  const atCustomer = toCustomer !== null && toCustomer <= ARRIVE_METERS;
  const toShop = here ? distanceMeters(here, shop) : null;
  const atShop = toShop !== null && toShop <= ARRIVE_METERS;
  const pins: MapPin[] = [
    { key: 'customer', at: customer, title: job.customer_name, color: PinColor.customer, icon: 'person' },
    { key: 'shop', at: shop, title: job.store_name, color: PinColor.shop, icon: 'store' },
    ...(here ? [{ key: 'me', at: here, title: 'You', color: PinColor.driver, icon: 'motorcycle' as const }] : []),
  ];

  return (
    <Screen>
      <DropoffMap center={here ?? customer} pins={pins} />
      <ThemedText type="smallBold">{job.status === 'en_route_pickup' ? 'Go to the customer' : 'Go to the laundry shop'}</ThemedText>
      <Card>
        <ThemedText type="smallBold">
          {job.customer_name} · {job.customer_phone}
        </ThemedText>
        <ThemedText type="small">Drop at: {job.store_name}</ThemedText>
        {job.delivery_fee !== undefined && <ThemedText type="small">You earn {peso(job.delivery_fee)} (paid by the shop)</ThemedText>}
      </Card>
      {job.status === 'en_route_pickup' && <JobChat chat={chat} me="driver" otherName={job.customer_name} send={send} connected={connected} />}
      <ErrorText error={action.error} />
      {job.status === 'en_route_pickup' && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {nearText(toCustomer, atCustomer, 'customer', 'pick up')}
          </ThemedText>
          <Button
            title="Confirm & Pickup Now"
            disabled={!atCustomer}
            loading={action.isPending && action.variables?.action === 'picked-up'}
            onPress={() => action.mutate({ action: 'picked-up' })}
          />
        </>
      )}
      {tracking && !arrived && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {customerOnline === false
              ? 'The customer is offline. You can cancel this trip.'
              : 'You can cancel only while the customer is offline.'}
          </ThemedText>
          <Button
            title="Cancel Trip"
            variant="danger"
            disabled={!connected || customerOnline !== false}
            loading={action.isPending && action.variables?.action === 'driver-cancel'}
            onPress={() => action.mutate({ action: 'driver-cancel' }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['driver'] }) })}
          />
        </>
      )}
      {job.status === 'en_route_shop' && !arrived && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {nearText(toShop, atShop, 'shop', 'drop off')}
          </ThemedText>
          <Button title="Arrived at shop" disabled={!atShop} onPress={() => setArrived(true)} />
        </>
      )}
      {job.status === 'en_route_shop' && arrived && <DropForm job={job} />}
    </Screen>
  );
}
