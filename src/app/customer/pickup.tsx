import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
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
      {OPTIONS.map((option) => (
        <Card
          key={option.type}
          onPress={() => router.push({ pathname: '/customer/stores', params: { type: option.type, mode: 'pickup' } })}>
          <View style={styles.row}>
            <Icon name={option.icon} />
            <View style={styles.text}>
              <ThemedText type="smallBold">{option.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {option.body}
              </ThemedText>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  text: { flex: 1 },
});
