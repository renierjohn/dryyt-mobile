import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useStores } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import type { StoreType } from '@/lib/types';

const STORE_ICON = {
  laundry: { ios: 'washer.fill', android: 'local_laundry_service', web: 'local_laundry_service' },
  food: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
} as const;

export default function StoreList() {
  const { type, mode } = useLocalSearchParams<{ type: StoreType; mode: 'pickup' | 'dropoff' }>();
  const stores = useStores(type);
  const theme = useTheme();
  const [text, setText] = useState('');
  // The list is short and already loaded: filter it as the customer types, by name or address.
  const q = text.trim().toLowerCase();
  const shown = (stores.data ?? []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));

  return (
    <Screen
      edges={[]}
      onRefresh={stores.refetch}
      header={
        // Pinned: stays put while the list scrolls.
        <View style={[styles.filters, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
          <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Icon name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} color={theme.textSecondary} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Search stores"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              autoCorrect={false}
              style={[styles.input, { color: theme.text }]}
            />
          </View>
        </View>
      }>
      {stores.isPending && <ActivityIndicator />}
      <ErrorText error={stores.error} />
      {stores.isSuccess && stores.data.length === 0 && <ThemedText themeColor="textSecondary">No stores yet.</ThemedText>}
      {stores.isSuccess && stores.data.length > 0 && shown.length === 0 && (
        <ThemedText themeColor="textSecondary">No stores match “{text.trim()}”.</ThemedText>
      )}
      {shown.map((store) => (
        <Card
          key={store.id}
          onPress={() =>
            mode === 'dropoff'
              ? router.push({ pathname: '/customer/dropoff/location', params: { storeId: String(store.id) } })
              : router.push({ pathname: '/customer/new-order', params: { storeId: String(store.id) } })
          }>
          <View style={styles.row}>
            {/* The shop's photo (its logo); the service icon until it adds one. */}
            {store.store_logo ? (
              <Image testID={`store-photo-${store.id}`} source={{ uri: store.store_logo }} style={styles.photo} contentFit="cover" />
            ) : (
              <View testID={`store-photo-placeholder-${store.id}`} style={[styles.photo, styles.iconCircle, { backgroundColor: theme.primarySoft }]}>
                <Icon name={STORE_ICON[type] ?? STORE_ICON.laundry} size={26} color={theme.primary} />
              </View>
            )}
            <View style={styles.text}>
              <ThemedText type="smallBold">{store.name}</ThemedText>
              <View style={styles.address}>
                <Icon name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={14} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
                  {store.address}
                </ThemedText>
              </View>
            </View>
            <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} color={theme.textSecondary} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  photo: { width: 56, height: 56, borderRadius: 12 },
  iconCircle: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  address: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  filters: { padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.three },
  input: { flex: 1, minHeight: 44, fontSize: 16 },
});
