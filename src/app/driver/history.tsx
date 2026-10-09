import { StyleSheet, View } from 'react-native';

import { HistoryList } from '@/components/history-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useHistory } from '@/hooks/queries';
import { peso } from '@/lib/format';

export default function JobHistory() {
  const history = useHistory();
  const earnings = history.data?.pages[0]?.earnings;

  return (
    <Screen onRefresh={history.refresh}>
      <View style={styles.header}>
        <ThemedText type="subtitle">History</ThemedText>
        {earnings !== undefined && (
          <ThemedText type="smallBold" style={styles.earnings} accessibilityLabel={`Earnings ${peso(earnings)}`}>
            {peso(earnings)}
          </ThemedText>
        )}
      </View>
      <HistoryList history={history} role="driver" empty="No completed jobs yet." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  earnings: { color: Brand.success, fontSize: 20 },
});
