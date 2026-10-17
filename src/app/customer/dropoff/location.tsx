import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button } from '@/components/button';
import { DropoffMap, PinColor } from '@/components/dropoff-map';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useCreateDropoff, useStore } from '@/hooks/queries';
import { useCurrentLocation } from '@/hooks/use-location';
import type { LatLng } from '@/lib/types';

export default function DropoffLocation() {
  const storeId = Number(useLocalSearchParams<{ storeId: string }>().storeId);
  const store = useStore(storeId);
  const here = useCurrentLocation();
  const create = useCreateDropoff();
  const [pin, setPin] = useState<LatLng | null>(null);

  const shop = store.data?.lat != null && store.data.lng != null ? { lat: store.data.lat, lng: store.data.lng } : null;
  const at = pin ?? here.loc;
  // No road lookup here: the server measures the road distance when Find a driver books the drop off.
  const center = at ?? shop;

  return (
    <Screen edges={[]}>
      <ThemedText type="smallBold">{store.data?.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Tap the map to move the pickup pin.
      </ThemedText>
      {here.error && <ThemedText themeColor="textSecondary">{here.error}</ThemedText>}
      {center ? (
        <DropoffMap
          center={center}
          onPress={setPin}
          pins={[
            ...(at ? [{ key: 'me', at, title: 'Pickup here', color: PinColor.customer, icon: 'person' as const }] : []),
            ...(shop ? [{ key: 'shop', at: shop, title: store.data?.name, color: PinColor.shop, icon: 'store' as const }] : []),
          ]}
        />
      ) : (
        <ActivityIndicator />
      )}
      <ErrorText error={store.error ?? create.error} />
      <Button
        title="Find a driver"
        disabled={!at}
        loading={create.isPending}
        onPress={() =>
          at &&
          create.mutate(
            { store_id: storeId, lat: at.lat, lng: at.lng },
            { onSuccess: (d) => router.replace({ pathname: '/customer/dropoff/[id]', params: { id: String(d.id) } }) },
          )
        }
      />
    </Screen>
  );
}
