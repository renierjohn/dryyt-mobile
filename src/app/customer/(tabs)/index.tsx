import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { PICKUP_ENABLED } from '@/constants/features';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';

export default function CustomerHome() {
  const { state } = useAuth();
  const name = state.status === 'signedIn' ? state.user.name : '';

  return (
    <Screen>
      <ThemedText type="subtitle">Hi, {name}</ThemedText>
      <ThemedText themeColor="textSecondary">What do you need today?</ThemedText>
      {PICKUP_ENABLED && (
        <Card onPress={() => router.push('/customer/pickup')}>
          <View style={styles.row}>
            <Icon name={{ ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' }} />
            <View style={styles.text}>
              <ThemedText type="smallBold">Pickup</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                We pick up food, drinks, or finished laundry from a store and bring it to you.
              </ThemedText>
            </View>
          </View>
        </Card>
      )}
      <Card onPress={() => router.push({ pathname: '/customer/stores', params: { type: 'laundry', mode: 'dropoff' } })}>
        <View style={styles.row}>
          <Icon name={{ ios: 'tray.and.arrow.down.fill', android: 'move_to_inbox', web: 'move_to_inbox' }} />
          <View style={styles.text}>
            <ThemedText type="smallBold">Drop off</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              We collect your laundry and drop it at the laundry shop you choose.
            </ThemedText>
          </View>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  text: { flex: 1 },
});
