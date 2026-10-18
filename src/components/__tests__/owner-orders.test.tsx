import { fireEvent, render, screen } from '@testing-library/react-native';

import Orders from '@/app/owner/(tabs)/orders';

const mockConfirm = jest.fn();
const order = (id: number, status: string, extra: object = {}) => ({
  id, type: 'pickup', status, store_id: 1, store_type: 'food', store_name: 'Tea Haven', store_address: '12 Mabini St', customer_address: 'Pinned location',
  notes: '', items: [], items_total: 20000, delivery_fee: 7920, payment_ref: '', payment_photo_key: null,
  created_at: '2026-10-17 04:00:00', ...extra,
});
jest.mock('@/hooks/queries', () => ({
  useOwnerOrders: () => ({
    data: {
      pages: [
        {
          orders: [
            order(4, 'awaiting_payment', { payment_ref: 'GC-123', payment_photo_key: 'payments/9/a.jpg', created_at: '2026-10-18 04:00:00' }),
            order(3, 'delivered', { items_total: 15000 }),
            order(2, 'cancelled', { items_total: 99900 }),
            order(1, 'pending', { items_total: 5000, created_at: '2026-10-16 04:00:00' }),
          ],
          next: null,
        },
      ],
    },
    isPending: false,
    isSuccess: true,
    error: null,
    refetch: jest.fn(),
  }),
  useConfirmPayment: () => ({ mutate: mockConfirm, isPending: false, error: null }),
}));
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
jest.mock('@/components/photo-viewer');
jest.mock('@/lib/api', () => ({ apiUrl: (p: string) => `https://api.test${p}`, authHeaders: () => ({ authorization: 'Bearer t' }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it('shows the proof of payment and Done Pay only while the order waits for payment', async () => {
  await render(<Orders />);
  expect(screen.getByText('Reference no.: GC-123')).toBeTruthy();
  expect([screen.getByTestId('payment-photo-4').props.source].flat()[0]).toMatchObject({
    uri: 'https://api.test/owner/orders/4/payment-photo',
    headers: { authorization: 'Bearer t' },
  });
  expect(screen.getAllByText('Done Pay')).toHaveLength(1);
  await fireEvent.press(screen.getByText('Done Pay'));
  expect(mockConfirm).toHaveBeenCalledWith(4);
});

it("groups orders by the day they were placed, with the day's order amount (no fees, no cancelled orders) on the right", async () => {
  await render(<Orders />);
  expect(screen.getAllByText(/^\w{3}, \w{3} \d+, 2026$/).map((t) => t.props.children)).toEqual([
    'Sun, Oct 18, 2026',
    'Sat, Oct 17, 2026',
    'Fri, Oct 16, 2026',
  ]);
  expect(screen.getAllByText('orders')).toHaveLength(3);
  expect(screen.getByText('₱200.00')).toBeTruthy();
  expect(screen.getByText('₱150.00')).toBeTruthy();
  expect(screen.getByText('₱50.00')).toBeTruthy();
});

it("pins each day's title to the top while its orders scroll by", async () => {
  await render(<Orders />);
  // Title, the dev countdown and the error slot sit above the list; then day, order, day, order, order, day, order.
  expect(mockSticky).toHaveBeenLastCalledWith([3, 5, 8]);
  expect(screen.getAllByTestId('order-day')).toHaveLength(3);
});

it('opens the payment photo full screen when tapped, and closes it', async () => {
  await render(<Orders />);
  expect(screen.queryByTestId('photo-viewer')).toBeNull();
  await fireEvent.press(screen.getByLabelText('View payment photo'));
  expect(screen.getByText('https://api.test/owner/orders/4/payment-photo')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('photo-viewer'));
  expect(screen.queryByTestId('photo-viewer')).toBeNull();
});
