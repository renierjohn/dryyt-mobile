import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ServiceTile } from '@/components/service-tile';
import { Spacing } from '@/constants/theme';
import type { StoreType } from '@/lib/types';

const OPTIONS = [
  {
    type: 'food',
    title: 'Food/Beverages',
    body: 'Milk tea, coffee, burgers, meals — we pick it up from the store.',
    icon: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  },
  {
    type: 'laundry',
    title: 'Laundry',
    body: 'Your laundry is done — we bring it home from the shop.',
    icon: { ios: 'washer.fill', android: 'local_laundry_service', web: 'local_laundry_service' },
  },
] as const satisfies readonly { type: StoreType; title: string; body: string; icon: object }[];

export default function Pickup() {
  return (
    <Screen edges={[]}>
      <View style={styles.grid}>
        {OPTIONS.map((option) => (
          <ServiceTile
            key={option.type}
            icon={option.icon}
            title={option.title}
            body={option.body}
            onPress={() =>
              // Food opens the same store-grouped menu as Home's "Popular now" → More.
              option.type === 'food'
                ? router.push('/customer/popular')
                : router.push({ pathname: '/customer/stores', params: { type: option.type, mode: 'pickup' } })
            }
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: Spacing.three },
});
