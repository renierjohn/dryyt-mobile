import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PinColor } from '@/components/dropoff-map';
import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import { useWatchLocation } from '@/hooks/use-location';
import { useNewJobSound } from '@/hooks/use-new-job-sound';
import { useSocket, type SocketMessage } from '@/hooks/use-socket';
import { d1Time, peso } from '@/lib/format';
import type { DispatchRequest, LatLng } from '@/lib/types';

/** Matches the worker's CONFIRM_TIMEOUT_MS. */
const CONFIRM_SECONDS = 60;

/** Seconds left until `seconds` have passed since `startedAt` (D1 UTC text), ticking each second. */
function Countdown({ startedAt, seconds }: { startedAt: string; seconds: number }) {
  const end = d1Time(startedAt) + seconds * 1000;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (Number.isNaN(end)) return null;
  return <>{` ${Math.max(0, Math.ceil((end - now) / 1000))}s`}</>;
}

/** Live drop off requests near the driver. Sends the driver's location while mounted. */
export function DropoffRequests({ acceptedAt }: { acceptedAt: string | null }) {
  const waitingForCustomer = acceptedAt !== null;
  const qc = useQueryClient();
  const [items, setItems] = useState<DispatchRequest[]>([]);
  const [acceptingId, setAccepting] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Latest fix, resent on (re)connect so the driver gets requests without waiting for the next one.
  const lastLoc = useRef<LatLng | null>(null);

  function onMessage(msg: SocketMessage) {
    if (msg.t === 'requests') {
      setItems(msg.items);
      if (acceptingId !== null && !msg.items.some((r: DispatchRequest) => r.transaction_id === acceptingId)) setAccepting(null);
    } else if (msg.t === 'taken') {
      setItems((list) => list.filter((r) => r.transaction_id !== msg.transaction_id));
      if (acceptingId === msg.transaction_id) {
        setNotice('Another driver took that one.');
        setAccepting(null);
      }
    } else if (msg.t === 'error') {
      setNotice(msg.message);
      setAccepting(null);
    } else {
      setAccepting(null);
      if (msg.t === 'released') setNotice('The customer chose another driver.');
      if (msg.t === 'cancelled') setNotice('The customer cancelled.');
      qc.invalidateQueries({ queryKey: ['driver'] });
      if (msg.t === 'confirmed') router.navigate('/driver/active');
    }
  }
  const { connected, send } = useSocket('dispatch', onMessage, (sendNow) => {
    if (lastLoc.current) sendNow({ t: 'loc', ...lastLoc.current });
  });
  const accepting = connected ? acceptingId : null;
  useWatchLocation(true, (at) => {
    lastLoc.current = at;
    send({ t: 'loc', ...at });
  });
  useNewJobSound(
    items.map((r) => `dropoff-${r.transaction_id}`),
    !waitingForCustomer,
  );

  if (acceptedAt !== null) {
    return (
      <Card>
        <ThemedText type="smallBold">
          Waiting for the customer to confirm…
          <Countdown startedAt={acceptedAt} seconds={CONFIRM_SECONDS} />
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          They have 60 seconds. You&apos;ll be released automatically if they don&apos;t answer.
        </ThemedText>
      </Card>
    );
  }

  return (
    <>
      <ThemedText type="smallBold">Drop offs near you</ThemedText>
      {!connected && <ThemedText themeColor="textSecondary">Connecting…</ThemedText>}
      {notice && <ThemedText themeColor="textSecondary">{notice}</ThemedText>}
      {connected && items.length === 0 && <ThemedText themeColor="textSecondary">No drop offs within 20 km right now.</ThemedText>}
      {items.map((r) => (
        <Card key={r.transaction_id}>
          <ThemedText type="smallBold" style={{ color: r.colour === 'green' ? PinColor.near : PinColor.far }}>
            Customer is {r.distance_km} km away
          </ThemedText>
          {r.customer_name ? (
            <ThemedText type="small">
              {r.customer_name} · {r.customer_phone}
            </ThemedText>
          ) : null}
          <ThemedText type="small">Drop at: {r.store_name}</ThemedText>
          <ThemedText type="small">
            You earn{' '}
            <ThemedText type="smallBold" style={{ color: Brand.success }}>
              {peso(r.delivery_fee)}
            </ThemedText>
          </ThemedText>
          <Button
            title="Accept"
            loading={accepting === r.transaction_id}
            disabled={accepting !== null}
            onPress={() => {
              setNotice(null);
              setAccepting(r.transaction_id);
              send({ t: 'accept', transaction_id: r.transaction_id });
            }}
          />
        </Card>
      ))}
    </>
  );
}
