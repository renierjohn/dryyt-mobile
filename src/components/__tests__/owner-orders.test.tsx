import { fireEvent, render, screen } from '@testing-library/react-native';

import Orders from '@/app/owner/(tabs)/orders';

const mockConfirm = jest.fn();
const order = (id: number, status: string, extra: object = {}) => ({
  id, type: 'pickup', status, store_id: 1, store_type: 'food', store_name: 'Tea Haven', store_address: '12 Mabini St', customer_address: 'Pinned location',
  notes: '', items: [], items_total: 20000, delivery_fee: 7920, payment_ref: '', payment_photo_key: null, ...extra,
});
jest.mock('@/hooks/queries', () => ({
  useOwnerOrders: () => ({
    data: { pages: [{ orders: [order(2, 'awaiting_payment', { payment_ref: 'GC-123', payment_photo_key: 'payments/9/a.jpg' }), order(1, 'pending')], next: null }] },
    isPending: false,
    isSuccess: true,
    error: null,
    refetch: jest.fn(),
  }),
  useConfirmPayment: () => ({ mutate: mockConfirm, isPending: false, error: null }),
}));
jest.mock('@/lib/api', () => ({ apiUrl: (p: string) => `https://api.test${p}`, authHeaders: () => ({ authorization: 'Bearer t' }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it('shows the proof of payment and Done Pay only while the order waits for payment', async () => {
  await render(<Orders />);
  expect(screen.getByText('Reference no.: GC-123')).toBeTruthy();
  expect([screen.getByTestId('payment-photo-2').props.source].flat()[0]).toMatchObject({
    uri: 'https://api.test/owner/orders/2/payment-photo',
    headers: { authorization: 'Bearer t' },
  });
  expect(screen.getAllByText('Done Pay')).toHaveLength(1);
  await fireEvent.press(screen.getByText('Done Pay'));
  expect(mockConfirm).toHaveBeenCalledWith(2);
});
