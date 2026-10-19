import { StyleSheet, View } from 'react-native';

import { HistoryScreen } from '@/components/history-list';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useHistory, type HistoryItem } from '@/hooks/queries';
import { peso } from '@/lib/format';

/** The driver's share: the delivery fee minus the service fee; nothing for cancelled jobs. */
function earned(item: HistoryItem) {
  if (item.kind === 'order') return item.order.status === 'cancelled' ? 0 : item.order.delivery_fee - item.order.service_fee;
  return item.dropoff.status === 'cancelled' ? 0 : (item.dropoff.delivery_fee ?? 0);
}

export default function JobHistory() {
  const history = useHistory();
  const earnings = history.data?.pages[0]?.earnings;

  return (
    <HistoryScreen
      history={history}
      role="driver"
      empty="No completed jobs yet."
      amount={(items) => items.reduce((sum, x) => sum + earned(x), 0)}
      title={
        <View key="title" style={styles.header}>
          <ThemedText type="subtitle">History</ThemedText>
          {earnings !== undefined && (
            <ThemedText type="smallBold" style={styles.earnings} accessibilityLabel={`Earnings ${peso(earnings)}`}>
              {peso(earnings)}
            </ThemedText>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  earnings: { color: Brand.success, fontSize: 20 },
});
