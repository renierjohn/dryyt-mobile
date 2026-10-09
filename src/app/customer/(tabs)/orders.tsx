import { HistoryList } from '@/components/history-list';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { useHistory } from '@/hooks/queries';

export default function MyOrders() {
  const history = useHistory();

  return (
    <Screen onRefresh={history.refresh}>
      <ThemedText type="subtitle">Orders</ThemedText>
      <HistoryList history={history} role="customer" empty="No orders yet." />
    </Screen>
  );
}
