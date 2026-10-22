import { render, screen } from '@testing-library/react-native';

import MyOrders from '@/app/customer/(tabs)/orders';

const dropoff = (id: number, created_at: string, store_logo: string | null = null) => ({
  kind: 'dropoff',
  dropoff: { id, status: 'completed', created_at, updated_at: created_at, total_delivery_fee: 5000, laundry_fee: null, store_name: 'Shop', store_logo },
});
jest.mock('@/hooks/queries', () => ({
  useHistory: () => ({
    data: { pages: [{ items: [dropoff(3, '2026-10-18 04:00:00', 'https://img.test/logo.jpg'), dropoff(2, '2026-10-18 03:00:00'), dropoff(1, '2026-10-16 04:00:00')], next: null }] },
    isPending: false,
    isSuccess: true,
    error: null,
    nextAt: 0,
    refresh: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockSticky = jest.fn();
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

it('groups orders by the day they were placed under sticky date titles, with no amount', async () => {
  await render(<MyOrders />);
  expect(screen.getAllByTestId('history-day').map((t) => t.children.length)).toEqual([1, 1]);
  expect(screen.getByText('Sun, Oct 18, 2026')).toBeTruthy();
  expect(screen.getByText('Fri, Oct 16, 2026')).toBeTruthy();
  // Title and the error slot sit above the list; then day, order, order, day, order.
  expect(mockSticky).toHaveBeenLastCalledWith([2, 5]);
});

it("shows each drop off's store logo, or a placeholder", async () => {
  await render(<MyOrders />);
  expect([screen.getByTestId('dropoff-store-logo').props.source].flat()).toEqual([{ uri: 'https://img.test/logo.jpg' }]);
  expect(screen.getAllByTestId('dropoff-store-logo-placeholder')).toHaveLength(2);
});
