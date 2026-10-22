import { fireEvent, render, screen } from '@testing-library/react-native';

import Orders from '@/app/owner/(tabs)/orders';

const mockSetFee = jest.fn();
jest.mock('@/hooks/queries', () => ({
  useOwnerOrders: () => ({
    data: {
      pages: [
        {
          orders: [
            {
              id: 9, type: 'pickup', status: 'awaiting_fee', store_id: 4, store_type: 'laundry', store_name: 'Suds', store_address: '1 Main St',
              customer_address: 'Pinned location', notes: '2 bags, ticket #42', items: [], items_total: 0, delivery_fee: 6000, service_fee: 900,
              total_delivery_fee: 6900, payment_ref: '', payment_photo_key: null, created_at: '2026-10-22 04:00:00',
            },
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
  useConfirmPayment: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useSetLaundryFee: () => ({ mutate: mockSetFee, isPending: false, error: null }),
}));
jest.mock('@/components/photo-viewer');
jest.mock('@/lib/api', () => ({ apiUrl: (p: string) => `https://api.test${p}`, authHeaders: () => ({ authorization: 'Bearer t' }) }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it('opens a laundry pickup waiting for its fee with the note and fees, and sets the laundry fee in centavos', async () => {
  await render(<Orders />);
  expect(screen.getByTestId('order-notes-9').props.children).toBe('2 bags, ticket #42');
  expect(screen.getByText(/^Notes:/)).toBeTruthy();
  // Once, on top: the summary doesn't repeat it.
  expect(screen.getAllByText('Notes: 2 bags, ticket #42')).toHaveLength(1);
  expect(screen.getByText('₱60.00')).toBeTruthy(); // delivery fee (driver's share)
  expect(screen.getByText('₱9.00')).toBeTruthy(); // service fee
  expect(screen.getByText('Set by the shop')).toBeTruthy();

  const confirm = screen.getByText('Confirm');
  await fireEvent.changeText(screen.getByPlaceholderText('e.g. 250'), '12.5.0');
  await fireEvent.press(confirm);
  expect(mockSetFee).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByPlaceholderText('e.g. 250'), '250.50');
  await fireEvent.press(screen.getByText('Confirm'));
  expect(mockSetFee).toHaveBeenCalledWith({ id: 9, laundry_fee: 25050 });
});

it('Laundry Fully Pay locks the fee at 0 and confirms it', async () => {
  mockSetFee.mockClear();
  await render(<Orders />);
  const field = screen.getByPlaceholderText('e.g. 250');
  await fireEvent.changeText(field, '250');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Laundry Fully Pay' }));
  expect(screen.getByPlaceholderText('e.g. 250').props.value).toBe('0');
  expect(screen.getByPlaceholderText('e.g. 250').props.editable).toBe(false);
  await fireEvent.press(screen.getByText('Confirm'));
  expect(mockSetFee).toHaveBeenCalledWith({ id: 9, laundry_fee: 0 });

  // Unchecked: the field opens again, empty.
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Laundry Fully Pay' }));
  expect(screen.getByPlaceholderText('e.g. 250').props.editable).toBe(true);
  expect(screen.getByPlaceholderText('e.g. 250').props.value).toBe('');
});
