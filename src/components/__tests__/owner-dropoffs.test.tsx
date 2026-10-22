import { render, screen } from '@testing-library/react-native';

import OwnerDropoffs from '@/app/owner/(tabs)/index';

const mockSticky = jest.fn();
const dropoff = (id: number, status: string, updated_at: string, laundry_fee: number | null = 10000) => ({
  id, status, updated_at, laundry_fee, store_name: 'Shop', customer_name: 'Ana', weight_kg: 5, total_delivery_fee: 5000,
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/queries', () => ({
  useOwnerDropoffs: () => ({
    data: {
      pages: [
        {
          // The worker's order: Not Yet Paid, then Pending, then Complete; newest first in each.
          dropoffs: [
            dropoff(5, 'payment_pending', '2026-10-18 04:00:00'),
            dropoff(4, 'dropped_off', '2026-10-18 03:00:00', null),
            dropoff(3, 'completed', '2026-10-17 04:00:00', 21000),
            dropoff(2, 'completed', '2026-10-17 03:00:00', 6000),
            dropoff(1, 'completed', '2026-10-16 04:00:00', 1000),
          ],
          next: null,
        },
      ],
    },
    isPending: false,
    isSuccess: true,
    error: null,
    refresh: jest.fn(),
    nextAt: 0,
  }),
}));
// The real Screen, recording which children it pins.
jest.mock('@/components/screen', () => {
  const { Screen } = jest.requireActual('@/components/screen');
  return {
    Screen: (props: { stickyHeaderIndices?: number[] }) => {
      mockSticky(props.stickyHeaderIndices);
      return <Screen {...props} />;
    },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it("pins each day's title to the top while its drop offs scroll by", async () => {
  await render(<OwnerDropoffs />);
  // Title and the error slot; then day, card, line, day, card, line, day, card, card, day, card.
  expect(mockSticky).toHaveBeenLastCalledWith([2, 5, 8, 11]);
  expect(screen.getAllByTestId('dropoff-day')).toHaveLength(4);
  // Completed days show their laundry fee total.
  expect(screen.getByText('₱270.00')).toBeTruthy();
  expect(screen.getByText('₱10.00')).toBeTruthy();
});
