import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { MenuEditor } from '@/components/menu-editor';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useOwnerStores, useSaveStore } from '@/hooks/queries';
import type { LatLng, Store, StoreType } from '@/lib/types';

/** `id` is "new" to add a shop. */
export default function StoreForm() {
  const param = useLocalSearchParams<{ id: string }>().id;
  const id = param === 'new' ? undefined : Number(param);
  const stores = useOwnerStores();
  const store = id ? stores.data?.find((s) => s.id === id) : undefined;

  if (id && !store)
    return <Screen edges={[]}>{stores.isPending ? <ActivityIndicator /> : <ErrorText error={stores.error ?? new Error('Shop not found')} />}</Screen>;
  return <Form store={store} />;
}

function Form({ store }: { store?: Store }) {
  const id = store?.id;
  const save = useSaveStore(id);
  const [name, setName] = useState(store?.name ?? '');
  const [type, setType] = useState<StoreType>(store?.type ?? 'laundry');
  const [address, setAddress] = useState(store?.address ?? '');
  const [loc, setLoc] = useState<LatLng | null>(store && store.lat !== null && store.lng !== null ? { lat: store.lat, lng: store.lng } : null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<Error | null>(null);

  const locate = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) throw new Error('Allow location access to pin your shop.');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (err) {
      setLocError(err as Error);
    } finally {
      setLocating(false);
    }
  };

  const submit = () =>
    save.mutate(
      {
        name: name.trim(),
        type,
        address: address.trim(),
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
      },
      // A new food shop stays open so its menu can be added right away.
      {
        onSuccess: (saved) =>
          !id && saved.type === 'food'
            ? router.replace({
                pathname: '/owner/store/[id]',
                params: { id: String(saved.id) },
              })
            : router.back(),
      },
    );

  return (
    <Screen edges={[]}>
      <TextField label="Shop name" value={name} onChangeText={setName} />
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Type
        </ThemedText>
        <View style={styles.row}>
          {(['laundry', 'food'] as const).map((t) => (
            <View key={t} style={styles.option}>
              <Button title={t === 'laundry' ? 'Laundry' : 'Food'} variant={type === t ? 'primary' : 'secondary'} onPress={() => setType(t)} />
            </View>
          ))}
        </View>
      </View>
      <TextField label="Address" value={address} onChangeText={setAddress} multiline />
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Location (needed for drop offs)
        </ThemedText>
        <ThemedText>{loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Not set'}</ThemedText>
        <Button title="Use my current location" variant="secondary" loading={locating} onPress={locate} />
        <ErrorText error={locError} />
      </View>
      <ErrorText error={save.error} />
      <Button title={id ? 'Save' : 'Add shop'} loading={save.isPending} disabled={!name.trim() || !address.trim()} onPress={submit} />
      {type === 'food' &&
        (id && store?.type === 'food' ? (
          <MenuEditor storeId={id} />
        ) : (
          <ThemedText themeColor="textSecondary">Save the shop to add its menu.</ThemedText>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two },
  option: { flex: 1 },
});
