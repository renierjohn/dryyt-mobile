import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { HeaderBand } from '@/components/header-band';
import { HistoryCard, historyKey } from '@/components/history-list';
import { Screen } from '@/components/screen';
import { ServiceTile } from '@/components/service-tile';
import { ThemedText } from '@/components/themed-text';
import { PICKUP_ENABLED } from '@/constants/features';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useHistory } from '@/hooks/queries';

export default function CustomerHome() {
  const { state } = useAuth();
  const name = state.status === 'signedIn' ? state.user.name : '';
  const history = useHistory();
  const recent = history.data?.pages[0]?.items.slice(0, 3) ?? [];

  return (
    <Screen edges={[]} onRefresh={history.refresh} header={<HeaderBand title={`Hi, ${name}`} subtitle="What do you need today?" />}>
      <View style={styles.tiles}>
        {PICKUP_ENABLED && (
          <ServiceTile
            icon={{ ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' }}
            title="Pickup"
            body="We pick up food, drinks, or finished laundry from a store and bring it to you."
            onPress={() => router.push('/customer/pickup')}
          />
        )}
        <ServiceTile
          icon={{ ios: 'tray.and.arrow.down.fill', android: 'move_to_inbox', web: 'move_to_inbox' }}
          title="Drop off"
          body="We collect your laundry and drop it at the laundry shop you choose."
          onPress={() => router.push({ pathname: '/customer/stores', params: { type: 'laundry', mode: 'dropoff' } })}
        />
      </View>
      {recent.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Recent orders</ThemedText>
            <Pressable onPress={() => router.push('/customer/orders')}>
              <ThemedText type="linkPrimary">See all</ThemedText>
            </Pressable>
          </View>
          {recent.map((item) => (
            <HistoryCard key={historyKey(item)} item={item} role="customer" />
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: Spacing.three },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
