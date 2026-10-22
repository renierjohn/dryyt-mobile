import { fireEvent, render, screen } from '@testing-library/react-native';

import StorePage from '@/app/customer/new-order';
import { LaundryPayment } from '@/components/payment-method';
import { OrderSummary } from '@/components/order-summary';
import { CartProvider } from '@/hooks/use-cart';

const mockCreate = jest.fn();
const mockSend = jest.fn();
let mockPin: { at: object | null; fee: number | null; quote: object } = { at: { lat: 14.56, lng: 121.03 }, fee: null, quote: {} };
jest.mock('@/hooks/queries', () => ({
  useStore: () => ({
    data: {
      id: 4, name: 'Suds', type: 'laundry', address: '1 Main St', lat: 14.55, lng: 121.02, store_logo: null, menu: [],
      store_payment_gateway: [{ label: 'GCash', image_url: 'https://img.test/gcash.png' }, { label: 'Maya', image_url: 'https://img.test/maya.png' }],
    },
    isPending: false, isError: false, isSuccess: true, error: null,
  }),
  useCreateOrder: () => ({ mutate: mockCreate, isPending: false, error: null }),
  useUploadPaymentPhoto: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useSendPayment: () => ({ mutate: mockSend, isPending: false, error: null }),
}));
jest.mock('@/components/delivery-pin', () => ({ DeliveryPinCard: () => null, useDeliveryPin: () => mockPin }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ storeId: '4' }), Stack: { Screen: () => null } }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const order = {
  id: 9, type: 'pickup', store_id: 4, store_type: 'laundry', store_name: 'Suds', store_address: '1 Main St', customer_address: 'Pinned location',
  status: 'to_pay', notes: '2 bags', items: [], items_total: 25000, delivery_fee: 6000, service_fee: 900, total_delivery_fee: 6900,
  payment_ref: '', payment_photo_key: null,
} as never;

const renderStore = () =>
  render(
    <CartProvider>
      <StorePage />
    </CartProvider>,
  );

beforeEach(() => jest.clearAllMocks());

it('asks for the note only after the delivery fee is computed, then sends the order to the shop', async () => {
  mockPin = { at: { lat: 14.56, lng: 121.03 }, fee: null, quote: {} };
  const { rerender } = await renderStore();
  expect(screen.queryByText('Note')).toBeNull();
  expect(screen.queryByText('Send to shop')).toBeNull();

  mockPin = { at: { lat: 14.56, lng: 121.03 }, fee: 6900, quote: { data: { token: 'tok' } } };
  await rerender(
    <CartProvider>
      <StorePage />
    </CartProvider>,
  );
  await fireEvent.changeText(screen.getByPlaceholderText(/claim ticket/), ' 2 bags, ticket #42 ');
  await fireEvent.press(screen.getByText('Send to shop'));
  expect(mockCreate.mock.calls[0][0]).toEqual({
    type: 'pickup', store_id: 4, items: [], lat: 14.56, lng: 121.03, notes: '2 bags, ticket #42', quote_token: 'tok',
  });
});

it('shows the chosen payment method QR, then sends the proof', async () => {
  await render(<LaundryPayment order={order} />);
  expect(screen.getByText('Pay ₱319.00 to Suds, then send your proof of payment.')).toBeTruthy();
  expect(screen.queryByTestId('payment-qr')).toBeNull();

  await fireEvent.press(screen.getByText('Maya'));
  expect(screen.getByTestId('or-divider')).toBeTruthy();
  expect([screen.getByTestId('payment-qr').props.source].flat()).toEqual([{ uri: 'https://img.test/maya.png' }]);
  await fireEvent.changeText(screen.getByDisplayValue(''), 'MAYA-77');
  await fireEvent.press(screen.getByText('Send proof of payment'));
  expect(mockSend).toHaveBeenCalledWith({ payment_ref: 'MAYA-77', payment_photo_key: undefined });
});

it('labels the laundry fee, pending until the shop sets it', async () => {
  const { rerender } = await render(<OrderSummary order={{ ...(order as object), status: 'awaiting_fee', items_total: 0 } as never} />);
  expect(screen.getByText('Laundry fee')).toBeTruthy();
  expect(screen.getByText('Set by the shop')).toBeTruthy();
  expect(screen.getByText('₱69.00 + laundry fee')).toBeTruthy();

  await rerender(<OrderSummary order={order} />);
  expect(screen.getByText('₱250.00')).toBeTruthy();
  expect(screen.getByText('₱319.00')).toBeTruthy();
});
