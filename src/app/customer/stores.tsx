import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

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

  return (
    <Screen edges={[]} onRefresh={stores.refetch}>
      {stores.isPending && <ActivityIndicator />}
      <ErrorText error={stores.error} />
      {stores.isSuccess && stores.data.length === 0 && <ThemedText themeColor="textSecondary">No stores yet.</ThemedText>}
      {stores.data?.map((store) => (
        <Card
          key={store.id}
          onPress={() =>
            mode === 'dropoff'
              ? router.push({ pathname: '/customer/dropoff/location', params: { storeId: String(store.id) } })
              : router.push({ pathname: '/customer/new-order', params: { storeId: String(store.id) } })
          }>
          <View style={styles.row}>
            <View style={[styles.iconCircle, { backgroundColor: theme.primarySoft }]}>
              <Icon name={STORE_ICON[type] ?? STORE_ICON.laundry} size={22} color={theme.primary} />
            </View>
            <View style={styles.text}>
              <ThemedText type="smallBold">{store.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {store.address}
              </ThemedText>
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
  iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
});
