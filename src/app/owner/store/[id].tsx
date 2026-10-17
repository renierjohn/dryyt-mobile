import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { MenuEditor } from '@/components/menu-editor';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useOwnerStores, useSaveStore, useUploadStoreImage } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import type { LatLng, PaymentGateway, Store, StoreType } from '@/lib/types';

const MAX_PAYMENT_QRS = 3;

/** `id` is "new" to add a shop. */
export default function StoreForm() {
  const param = useLocalSearchParams<{ id: string }>().id;
  const id = param === 'new' ? undefined : Number(param);
  const stores = useOwnerStores();
  const store = id ? stores.data?.stores.find((s) => s.id === id) : undefined;

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
  const [logo, setLogo] = useState<string | null>(store?.store_logo ?? null);
  const [gateways, setGateways] = useState<PaymentGateway[]>(store?.store_payment_gateway ?? []);
  const upload = useUploadStoreImage();
  /** Which image is uploading: the logo, a QR's index, or a new QR (its index is the list length). */
  const uploading = upload.isPending ? upload.variables.target : null;

  /** `target` is 'logo' or the index of the QR to set; an index past the end adds a QR. */
  const pickImage = async (target: 'logo' | number) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    upload.mutate(
      { uri: asset.uri, width: asset.width, height: asset.height, target },
      {
        onSuccess: (url) =>
          target === 'logo'
            ? setLogo(url)
            : setGateways((list) =>
                target < list.length ? list.map((g, i) => (i === target ? { ...g, image_url: url } : g)) : [...list, { label: '', image_url: url }],
              ),
      },
    );
  };

  const setLabel = (index: number, label: string) => setGateways((list) => list.map((g, i) => (i === index ? { ...g, label } : g)));
  const removeGateway = (index: number) => setGateways((list) => list.filter((_, i) => i !== index));
  const gatewaysValid = gateways.every((g) => g.label.trim() !== '');

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
        store_logo: logo,
        store_payment_gateway: gateways.map((g) => ({ ...g, label: g.label.trim() })),
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
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Logo
        </ThemedText>
        <View style={styles.row}>
          <ImageBox url={logo} label={logo ? 'Change logo' : 'Add logo'} loading={uploading === 'logo'} disabled={upload.isPending} onPress={() => pickImage('logo')} />
          {logo && (
            <View style={styles.option}>
              <Button title="Remove logo" variant="secondary" disabled={upload.isPending} onPress={() => setLogo(null)} />
            </View>
          )}
        </View>
      </View>
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
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Payment QR codes (up to {MAX_PAYMENT_QRS})
        </ThemedText>
        {gateways.map((g, i) => (
          <View key={i} style={styles.row}>
            <ImageBox url={g.image_url} label={`Change QR ${i + 1}`} loading={uploading === i} disabled={upload.isPending} onPress={() => pickImage(i)} />
            <View style={styles.option}>
              <TextField label="Name / account" value={g.label} onChangeText={(text) => setLabel(i, text)} placeholder="e.g. GCash 0917 123 4567" />
            </View>
            <Pressable onPress={() => removeGateway(i)} disabled={upload.isPending} hitSlop={12} accessibilityLabel={`Remove QR ${i + 1}`}>
              <Icon name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={22} color={Brand.danger} />
            </Pressable>
          </View>
        ))}
        {gateways.length < MAX_PAYMENT_QRS && (
          <Button
            title="Add payment QR"
            variant="secondary"
            loading={uploading === gateways.length}
            disabled={upload.isPending}
            onPress={() => pickImage(gateways.length)}
          />
        )}
        {!gatewaysValid && <ThemedText themeColor="textSecondary">Name each QR before saving.</ThemedText>}
        <ErrorText error={upload.error} />
      </View>
      <ErrorText error={save.error} />
      <Button
        title={id ? 'Save' : 'Add shop'}
        loading={save.isPending}
        disabled={!name.trim() || !address.trim() || !gatewaysValid || upload.isPending}
        onPress={submit}
      />
      {type === 'food' &&
        (id && store?.type === 'food' ? (
          <MenuEditor storeId={id} />
        ) : (
          <ThemedText themeColor="textSecondary">Save the shop to add its menu.</ThemedText>
        ))}
    </Screen>
  );
}

/** Square thumbnail of a logo or QR; tap to pick a new image. */
function ImageBox({ url, label, loading, disabled, onPress }: { url: string | null; label: string; loading: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label}>
      <View style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
        {url ? (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Icon name={{ ios: 'photo.badge.plus', android: 'add_photo_alternate', web: 'add_photo_alternate' }} />
        )}
        {loading && <ActivityIndicator style={StyleSheet.absoluteFill} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two },
  option: { flex: 1 },
  box: { width: 88, height: 88, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
