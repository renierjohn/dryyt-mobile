import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DropoffMap, PinColor } from '@/components/dropoff-map';
import { ErrorText } from '@/components/error-text';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useOrderQuote, useRoadRoute, useStore } from '@/hooks/queries';
import { useCurrentLocation } from '@/hooks/use-location';
import { peso } from '@/lib/format';
import type { LatLng } from '@/lib/types';

/**
 * The customer's delivery pin for a pickup from `storeId` and its quote. `at` is where it delivers (null until located),
 * `fee` the delivery fee the customer pays (service fee included) once Compute Delivery Fee is pressed.
 */
export function useDeliveryPin(storeId: number) {
  const quote = useOrderQuote();
  const details = useStore(storeId);
  const here = useCurrentLocation();
  const [pin, setPin] = useState<LatLng | null>(null);

  const shop = details.data?.lat != null && details.data.lng != null ? { lat: details.data.lat, lng: details.data.lng } : null;
  // Once Compute Delivery Fee is pressed the pin is locked where it was priced: no taps, no GPS refinements.
  const locked = (quote.isPending || quote.isSuccess) && quote.variables ? { lat: quote.variables.lat, lng: quote.variables.lng } : null;
  const at = locked ?? pin ?? here.loc;
  const fee = quote.data?.total_delivery_fee ?? null;
  const compute = () => at && quote.mutate({ store_id: storeId, lat: at.lat, lng: at.lng });
  return { at, shop, quoted: locked !== null, fee, quote, details, here, setPin, compute };
}

/** "Deliver to": the map with the shop and the customer's pin (tap to move it) and Compute Delivery Fee. */
export function DeliveryPinCard({ storeName, pin }: { storeName: string; pin: ReturnType<typeof useDeliveryPin> }) {
  const { at, shop, quoted, fee, quote, details, here } = pin;
  const center = at ?? shop;
  // The road is drawn only once Compute Delivery Fee is pressed, for the pin being priced.
  const route = useRoadRoute(quoted ? at : null, shop);
  return (
    <Card>
      <ThemedText type="smallBold">Deliver to</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {quoted ? 'Your pin is set for this delivery fee.' : 'Tap the map to move your pin.'}
      </ThemedText>
      {here.error && <ThemedText themeColor="textSecondary">{here.error}</ThemedText>}
      {center ? (
        <DropoffMap
          center={center}
          onPress={quoted ? undefined : pin.setPin}
          path={quoted ? route.data?.path : undefined}
          pins={[
            ...(at ? [{ key: 'me', at, title: 'Deliver here', color: PinColor.customer, icon: 'person' as const }] : []),
            ...(shop ? [{ key: 'shop', at: shop, title: storeName, color: PinColor.shop, icon: 'store' as const }] : []),
          ]}
        />
      ) : (
        <ActivityIndicator />
      )}
      {fee !== null ? (
        <View style={styles.row}>
          <ThemedText type="small" style={styles.grow}>
            Delivery fee · {quote.data!.road_km.toFixed(1)} km
          </ThemedText>
          <ThemedText type="smallBold">{peso(fee)}</ThemedText>
        </View>
      ) : (
        // Spins while the phone finds the customer's location (unless it failed: then a tap on the map sets the pin).
        <Button
          title="Compute Delivery Fee"
          variant="secondary"
          onPress={pin.compute}
          loading={quote.isPending}
          waiting={!at && !here.error}
          disabled={!at}
        />
      )}
      <ErrorText error={details.error ?? quote.error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
