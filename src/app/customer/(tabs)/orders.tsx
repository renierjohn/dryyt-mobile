import { HistoryScreen } from '@/components/history-list';
import { ThemedText } from '@/components/themed-text';
import { useHistory } from '@/hooks/queries';

export default function MyOrders() {
  const history = useHistory();

  return (
    <HistoryScreen
      history={history}
      role="customer"
      empty="No orders yet."
      title={
        <ThemedText key="title" type="subtitle">
          Orders
        </ThemedText>
      }
    />
  );
}
