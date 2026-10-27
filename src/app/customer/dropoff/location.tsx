import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { DropoffMap, PinColor } from '@/components/dropoff-map';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { VehicleOptions } from '@/components/vehicle-options';
import { useCreateDropoff, useDropoffQuote, useStore } from '@/hooks/queries';
import { useSignedIn } from '@/hooks/use-auth';
import { useCurrentLocation } from '@/hooks/use-location';
import type { LatLng } from '@/lib/types';

export default function DropoffLocation() {
  const storeId = Number(useLocalSearchParams<{ storeId: string }>().storeId);
  const store = useStore(storeId);
  const here = useCurrentLocation();
  const signedIn = useSignedIn();
  const quote = useDropoffQuote();
  const create = useCreateDropoff();
  const [pin, setPin] = useState<LatLng | null>(null);

  const shop = store.data?.lat != null && store.data.lng != null ? { lat: store.data.lat, lng: store.data.lng } : null;
  // Once Find a driver prices the trip the pin is locked where it was priced, so the booking matches the fees shown.
  const locked = (quote.isPending || quote.isSuccess) && quote.variables ? { lat: quote.variables.lat, lng: quote.variables.lng } : null;
  const at = locked ?? pin ?? here.loc;
  const center = at ?? shop;

  return (
    <Screen edges={[]}>
      <ThemedText type="smallBold">{store.data?.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {locked ? 'Your pin is set for these fees.' : 'Tap the map to move the pickup pin.'}
      </ThemedText>
      {here.error && <ThemedText themeColor="textSecondary">{here.error}</ThemedText>}
      {center ? (
        <DropoffMap
          center={center}
          onPress={locked ? undefined : setPin}
          pins={[
            ...(at ? [{ key: 'me', at, title: 'Pickup here', color: PinColor.customer, icon: 'person' as const }] : []),
            ...(shop ? [{ key: 'shop', at: shop, title: store.data?.name, color: PinColor.shop, icon: 'store' as const }] : []),
          ]}
        />
      ) : (
        <ActivityIndicator />
      )}
      <ErrorText error={store.error ?? quote.error ?? create.error} />
      {quote.data && at ? (
        <VehicleOptions
          options={quote.data.options}
          roadKm={quote.data.road_km}
          loading={create.isPending}
          onProceed={(o) =>
            create.mutate(
              { store_id: storeId, lat: at.lat, lng: at.lng, vehicle_type: o.vehicle_type, quote_token: quote.data!.token },
              { onSuccess: (d) => router.replace({ pathname: '/customer/dropoff/[id]', params: { id: String(d.id) } }) },
            )
          }
        />
      ) : (
        <Button
          title="Find a driver"
          disabled={!at}
          loading={quote.isPending}
          onPress={signedIn(() => at && quote.mutate({ store_id: storeId, lat: at.lat, lng: at.lng }))}
        />
      )}
    </Screen>
  );
}
