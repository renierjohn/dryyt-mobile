import { render, screen } from '@testing-library/react-native';

import Payouts from '@/app/owner/(tabs)/payouts';

const mockSticky = jest.fn();
const mockPayout = (id: number, payee_type: 'driver' | 'developer', payee_id: number | null) => ({
  id, transaction_id: id, payee_type, payee_id, payee_name: payee_id ? 'Ben' : null, store_name: 'Shop', amount: 5000,
  status: 'pending', paid_at: null, created_at: '2026-10-17 04:00:00',
});
const mockList = (key: string, items: object[]) => ({
  data: { pages: [{ [key]: items, next: null }] }, isPending: false, isSuccess: true, error: null, hasNextPage: false, refresh: jest.fn(), nextAt: 0,
});
const mockMutation = { mutate: jest.fn(), isPending: false, error: null };
jest.mock('@/hooks/queries', () => ({
  usePayouts: () => mockList('payouts', [mockPayout(1, 'developer', null), mockPayout(2, 'driver', 9)]),
  // The same driver in both driver sections.
  usePickupPayouts: () =>
    mockList('payouts', [{ id: 24, store_id: 1, store_name: 'Shop', driver_id: 9, driver_name: 'Ben', amount: 7600, paid_at: null, updated_at: '2026-10-17 04:00:00' }]),
  useMarkPayoutPaid: () => mockMutation,
  useMarkPickupPaid: () => mockMutation,
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

it('pins each section title to the top while its payouts scroll by', async () => {
  await render(<Payouts />);
  // Title, dev countdown, error slot; then service fee title, week card, drop off title, Ben's card, pickup title, Ben's card.
  expect(mockSticky).toHaveBeenLastCalledWith([3, 5, 7]);
  expect(screen.getAllByTestId('payout-section')).toHaveLength(3);
  expect(screen.getByText('Drivers · Pickup Delivery Fee')).toBeTruthy();
  expect(screen.getAllByText('Mark paid')).toHaveLength(2);
});
