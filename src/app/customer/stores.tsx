import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useStores } from '@/hooks/queries';
import type { StoreType } from '@/lib/types';

export default function StoreList() {
  const { type, mode } = useLocalSearchParams<{ type: StoreType; mode: 'pickup' | 'dropoff' }>();
  const stores = useStores(type);

  return (
    <Screen edges={[]} onRefresh={stores.refetch}>
      {stores.isPending && <ActivityIndicator />}
      <ErrorText error={stores.error} />
      {stores.data?.map((store) => (
        <Card
          key={store.id}
          onPress={() =>
            mode === 'dropoff'
              ? router.push({ pathname: '/customer/dropoff/location', params: { storeId: String(store.id) } })
              : router.push({ pathname: '/customer/new-order', params: { storeId: String(store.id) } })
          }>
          <View style={styles.row}>
            {type === 'laundry' && (
              <Icon name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={22} />
            )}
            <View style={styles.text}>
              <ThemedText type="smallBold">{store.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {store.address}
              </ThemedText>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
});
