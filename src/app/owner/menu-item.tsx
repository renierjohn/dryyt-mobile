import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AutocompleteField } from '@/components/autocomplete-field';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSaveMenuItem, useStore, useUploadMenuImage } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import type { MenuItem } from '@/lib/types';

/** `itemId` is "new" to add an item. */
export default function MenuItemScreen() {
  const params = useLocalSearchParams<{ storeId: string; itemId: string }>();
  const storeId = Number(params.storeId);
  const itemId = params.itemId === 'new' ? undefined : Number(params.itemId);
  const store = useStore(storeId);
  const item = itemId ? store.data?.menu.find((m) => m.id === itemId) : undefined;

  if (itemId && !item)
    return (
      <Screen edges={[]}>{store.isPending ? <ActivityIndicator /> : <ErrorText error={store.error ?? new Error('Menu item not found')} />}</Screen>
    );
  return <Form storeId={storeId} item={item} menu={store.data?.menu ?? []} />;
}

/** Whole pesos or with centavos, e.g. "120" or "99.50"; NaN when invalid. */
const toCentavos = (pesos: string) => (/^\d+(\.\d{1,2})?$/.test(pesos.trim()) ? Math.round(Number(pesos) * 100) : NaN);

function Form({ storeId, item, menu }: { storeId: number; item?: MenuItem; menu: MenuItem[] }) {
  const save = useSaveMenuItem(storeId, item?.id);
  const upload = useUploadMenuImage(storeId);
  const theme = useTheme();
  /** Categories already on this shop's menu, A-Z. */
  const categories = useMemo(() => [...new Set(menu.map((m) => m.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [menu]);
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item ? (item.price / 100).toFixed(2) : '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [discount, setDiscount] = useState(item ? String(item.discount_percent) : '0');
  const [imageUrl, setImageUrl] = useState<string | null>(item?.image_url ?? null);
  const [bestSeller, setBestSeller] = useState(item?.best_seller ?? false);

  const centavos = toCentavos(price);
  const percent = /^\d{1,3}$/.test(discount.trim()) ? Number(discount) : NaN;
  const valid = name.trim() !== '' && !Number.isNaN(centavos) && percent >= 0 && percent <= 100;

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    upload.mutate({ uri: asset.uri, width: asset.width, height: asset.height }, { onSuccess: setImageUrl });
  };

  const submit = () =>
    save.mutate(
      {
        name: name.trim(),
        price: centavos,
        category: category.trim(),
        discount_percent: percent,
        image_url: imageUrl,
        best_seller: bestSeller,
      },
      { onSuccess: () => router.back() },
    );

  return (
    <Screen edges={[]}>
      <TextField label="Name" value={name} onChangeText={setName} />
      <TextField label="Price (₱)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="e.g. 120.00" />
      <AutocompleteField label="Category" value={category} onChangeText={setCategory} options={categories} placeholder="e.g. Drinks, Mains" />
      <TextField label="Discount (%)" value={discount} onChangeText={setDiscount} keyboardType="number-pad" />
      <View style={styles.field}>
        <ThemedText type="small" themeColor="textSecondary">
          Photo
        </ThemedText>
        <Pressable onPress={pickImage} disabled={upload.isPending} accessibilityLabel={imageUrl ? 'Change photo' : 'Add photo'}>
          <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <>
                <Icon name={{ ios: 'photo.badge.plus', android: 'add_photo_alternate', web: 'add_photo_alternate' }} />
                <ThemedText type="small" themeColor="textSecondary">
                  Tap to choose a photo
                </ThemedText>
              </>
            )}
            {upload.isPending && <ActivityIndicator style={StyleSheet.absoluteFill} />}
          </View>
        </Pressable>
        {imageUrl && (
          <View style={styles.row}>
            <View style={styles.grow}>
              <Button title="Change photo" variant="secondary" disabled={upload.isPending} onPress={pickImage} />
            </View>
            <View style={styles.grow}>
              <Button title="Remove photo" variant="secondary" disabled={upload.isPending} onPress={() => setImageUrl(null)} />
            </View>
          </View>
        )}
        <ErrorText error={upload.error} />
      </View>
      <View style={styles.row}>
        <ThemedText style={styles.grow}>Best seller</ThemedText>
        <Switch value={bestSeller} onValueChange={setBestSeller} />
      </View>
      <ErrorText error={save.error} />
      <Button title={item ? 'Save' : 'Add item'} loading={save.isPending} disabled={!valid || upload.isPending} onPress={submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  field: { gap: Spacing.one },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
