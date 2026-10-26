import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import CartScreen from '@/app/customer/cart';
import { CartProvider, useCart } from '@/hooks/use-cart';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
const mockCreate = jest.fn();
const mockRoadRoute = jest.fn((_from: unknown) => ({ data: undefined }));
const mockQuote = { mutate: jest.fn(), isPending: false, isSuccess: false, error: null, data: undefined as { road_km: number; options: { vehicle_type: number; base_fee: number; rate_per_km: number; total_delivery_fee: number }[]; token: string } | undefined, variables: undefined as object | undefined };
jest.mock('@/hooks/queries', () => ({
  useCreateOrder: () => ({ mutate: mockCreate, isPending: false, error: null }),
  useOrderQuote: () => mockQuote,
  useStore: () => ({ data: { lat: 14.5547, lng: 121.0244, store_payment_gateway: [{ label: 'GCash 0917', image_url: 'https://img.test/qr.png' }] }, error: null }),
  useRoadRoute: (from: unknown) => mockRoadRoute(from),
  useUploadPaymentPhoto: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useOrder: () => mockOrder,
  usePlaceOrder: () => ({ mutate: mockPlace, isPending: false, error: null }),
}));
jest.mock('expo-image-picker', () => ({}));
const mockSocketRoom = jest.fn();
jest.mock('@/hooks/use-socket', () => ({
  useSocket: (room: string | null) => {
    mockSocketRoom(room);
    return { connected: room !== null, send: jest.fn() };
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn() }) }));
const mockPlace = jest.fn();
let mockOrder: { data?: object; isPending: boolean; error: null; refetch: () => void } = { isPending: true, error: null, refetch: jest.fn() };
jest.mock('@/hooks/use-location', () => ({ useCurrentLocation: () => ({ loc: { lat: 14.56, lng: 121.03 }, error: null }) }));
const mockMapProps = jest.fn();
jest.mock('@/components/dropoff-map', () => ({
  DropoffMap: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
  PinColor: {},
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const item = { id: 1, name: 'Milk Tea', price: 10000, image_url: 'https://img.test/tea.jpg', discount_percent: 0, category: 'Drinks', best_seller: false, popularity: 0 };

const waitingOrder = {
  id: 42, type: 'pickup', store_id: 1, store_type: 'food', store_name: 'Tea Haven', store_address: '12 Mabini St', customer_address: 'Pinned location',
  notes: '', items: [], items_total: 20000, delivery_fee: 7920, total_delivery_fee: 7920, payment_ref: 'GC-123', payment_photo_key: null,
};

function Harness({ orderId }: { orderId?: number }) {
  const cart = useCart();
  useEffect(() => {
    cart.add(item, { id: 1, name: 'Tea Haven' }, 2);
    if (orderId) cart.setOrderId(orderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <CartScreen />;
}

it('labels the footer amount as items only, plus delivery fee', async () => {
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect(screen.getByText('Items ₱200.00 + delivery fee')).toBeTruthy();
});

it('shows each line with its menu photo', async () => {
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect([screen.getByTestId('cart-line-photo-1').props.source].flat()).toEqual([{ uri: 'https://img.test/tea.jpg' }]);
});


beforeEach(() => {
  jest.clearAllMocks();
  mockQuote.data = undefined;
  mockQuote.variables = undefined;
  mockQuote.isSuccess = false;
});

it('has no address or notes fields', async () => {
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect(screen.queryByText('Delivery address')).toBeNull();
  expect(screen.queryByText('Notes')).toBeNull();
});

it('fetches no road until the delivery fee is computed for the pin', async () => {
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect(mockRoadRoute).toHaveBeenLastCalledWith(null);
  await fireEvent.press(screen.getByText('Compute Delivery Fee'));
  expect(mockQuote.mutate).toHaveBeenCalledWith({ store_id: 1, lat: 14.56, lng: 121.03 });
});

/** The computed fees: Proceed with a vehicle to see its fee and the payment step. */
const quoted = {
  road_km: 3.2,
  options: [
    { vehicle_type: 2, base_fee: 4000, rate_per_km: 1000, total_delivery_fee: 7920 },
    { vehicle_type: 4, base_fee: 10000, rate_per_km: 2000, total_delivery_fee: 18100 },
  ],
  token: 'q-token',
};
const chooseMotorcycle = async () => {
  await fireEvent.press(screen.getByLabelText('Motorcycle, base fare ₱40.00, delivery fee ₱79.20'));
  await fireEvent.press(screen.getByText('Proceed'));
};

it('lists every vehicle with its base fare and fee, and Proceed waits for a choice', async () => {
  mockQuote.data = quoted;
  mockQuote.variables = { store_id: 1, lat: 14.56, lng: 121.03 };
  mockQuote.isSuccess = true;
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect(screen.getByText('Motorcycle')).toBeTruthy();
  expect(screen.getByText('Car (lightweight)')).toBeTruthy();
  expect(screen.getByText('Base fare ₱100.00')).toBeTruthy();
  expect(screen.getByText('₱181.00')).toBeTruthy();
  expect(screen.getByLabelText('Proceed').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByText('Items ₱200.00 + delivery fee')).toBeTruthy();
});

it('shows the computed fee and total for the chosen vehicle', async () => {
  mockQuote.data = quoted;
  mockQuote.variables = { store_id: 1, lat: 14.56, lng: 121.03 };
  mockQuote.isSuccess = true;
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  await chooseMotorcycle();
  expect(mockRoadRoute).toHaveBeenLastCalledWith({ lat: 14.56, lng: 121.03 });
  expect(screen.getByText('₱79.20')).toBeTruthy();
  expect(screen.getByText('Total ₱279.20')).toBeTruthy();
});

it("shows the store's payment QR once the fee is computed, and sends the reference number as proof", async () => {
  mockQuote.data = quoted;
  mockQuote.variables = { store_id: 1, lat: 14.56, lng: 121.03 };
  mockQuote.isSuccess = true;
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  await chooseMotorcycle();
  // Same as laundry: pick a payment method to see its QR.
  expect(screen.queryByTestId('payment-qr')).toBeNull();
  await fireEvent.press(screen.getByText('GCash 0917'));
  expect([screen.getByTestId('payment-qr').props.source].flat()).toEqual([{ uri: 'https://img.test/qr.png' }]);
  expect(screen.getByTestId('or-divider')).toBeTruthy();
  expect(screen.getByText('Upload proof of payment')).toBeTruthy();
  expect(screen.getByLabelText('Place order').props.accessibilityState.disabled).toBe(true);

  // A reference number alone is enough proof.
  expect(screen.getByLabelText('Send proof of payment').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByDisplayValue(''), 'GC-123');
  await fireEvent.press(screen.getByText('Send proof of payment'));
  expect(mockCreate).toHaveBeenCalledWith(
    { type: 'pickup', store_id: 1, items: [{ menu_item_id: 1, qty: 2 }], lat: 14.56, lng: 121.03, payment_ref: 'GC-123', payment_photo_key: undefined, vehicle_type: 2, quote_token: 'q-token' },
    expect.anything(),
  );
});

it('sending the proof switches the cart to waiting for the store', async () => {
  mockQuote.data = quoted;
  mockQuote.variables = { store_id: 1, lat: 14.56, lng: 121.03 };
  mockQuote.isSuccess = true;
  mockCreate.mockImplementation((_input, { onSuccess }) => onSuccess({ id: 42 }));
  mockOrder = { data: { ...waitingOrder, status: 'awaiting_payment' }, isPending: false, error: null, refetch: jest.fn() };
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  await chooseMotorcycle();
  await fireEvent.press(screen.getByText('GCash 0917'));
  await fireEvent.changeText(screen.getByDisplayValue(''), 'GC-123');
  await fireEvent.press(screen.getByText('Send proof of payment'));

  expect(screen.getByText('Waiting for the store to confirm your payment…')).toBeTruthy();
  expect(mockSocketRoom).toHaveBeenLastCalledWith('order-42');
  expect(screen.getByLabelText('Place order').props.accessibilityState.disabled).toBe(true);
});

it('enables Place order once the store taps Done Pay', async () => {
  mockOrder = { data: { ...waitingOrder, status: 'payment_confirmed' }, isPending: false, error: null, refetch: jest.fn() };
  await render(
    <CartProvider>
      <Harness orderId={42} />
    </CartProvider>,
  );
  expect(screen.getByText('Payment confirmed. Place your order to find a driver.')).toBeTruthy();
  expect(mockSocketRoom).toHaveBeenLastCalledWith('order-42');
  await fireEvent.press(screen.getByText('Place order'));
  expect(mockPlace).toHaveBeenCalledWith(42, expect.anything());
});

it('lets the customer move the pin until the fee is computed, then locks it', async () => {
  const { rerender } = await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect(mockMapProps.mock.lastCall![0].onPress).toEqual(expect.any(Function));

  mockQuote.data = quoted;
  mockQuote.variables = { store_id: 1, lat: 14.5, lng: 121.1 };
  mockQuote.isSuccess = true;
  await rerender(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  const map = mockMapProps.mock.lastCall![0];
  expect(map.onPress).toBeUndefined();
  // The pin stays where the fee was priced, not where GPS says now.
  expect(map.pins[0].at).toEqual({ lat: 14.5, lng: 121.1 });
  expect(screen.getByText('Your pin is set for this delivery fee.')).toBeTruthy();
});
