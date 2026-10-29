import { fireEvent, render, screen } from '@testing-library/react-native';

import DropoffDetail from '@/app/customer/dropoff/[id]';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useLocalSearchParams: () => ({ id: '7' }) }));
jest.mock('@/hooks/use-socket', () => ({ useSocket: () => ({ connected: false }) }));
jest.mock('@/components/photo-viewer');
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/components/dropoff-map', () => ({ DropoffMap: () => null, PinColor: {} }));
// The shop's payment methods have their own tests; here it only reports the total and sends a proof.
jest.mock('@/components/payment-method', () => {
  const { createElement } = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    PaymentMethod: ({ total, onSend }: { total: number; onSend: (p: { payment_ref: string }) => void }) =>
      createElement(Pressable, { onPress: () => onSend({ payment_ref: 'REF1' }) }, createElement(Text, null, `Pay ${total}`)),
  };
});
const mockMutate = jest.fn();
let mockStatus = 'owner_confirmed';
let mockProof = { payment_ref: '', has_payment_photo: false };
jest.mock('@/hooks/queries', () => ({
  useDropoff: () => ({
    data: {
      id: 7, status: mockStatus, store_id: 1, store_name: 'Shop', customer_lat: 0, customer_lng: 0, shop_lat: 0, shop_lng: 0,
      customer_address: 'Here', total_delivery_fee: 5000, laundry_fee: 15000, vehicle_type: 2, weight_kg: 3, created_at: '2026-10-29 07:00:00',
      has_proof: false, ...mockProof,
    },
    refetch: jest.fn(),
  }),
  useDropoffAction: () => ({ mutate: mockMutate, isPending: false, error: null }),
  useCreateDropoff: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useRoadRoute: () => ({ data: undefined }),
}));

beforeEach(() => mockMutate.mockClear());

it('offers Pay now or Pay later once the shop confirms', async () => {
  mockStatus = 'owner_confirmed';
  await render(<DropoffDetail />);
  expect(screen.queryByText('Done Pay')).toBeNull();
  expect(screen.queryByText('Pay 20000')).toBeNull();

  await fireEvent.press(screen.getByText('Pay later'));
  expect(mockMutate).toHaveBeenCalledWith({ action: 'payment', body: { paid: false } });

  await fireEvent.press(screen.getByText('Pay now'));
  expect(screen.queryByText('Pay later')).toBeNull();
  await fireEvent.press(screen.getByText('Pay 20000'));
  expect(mockMutate).toHaveBeenLastCalledWith({ action: 'payment', body: { paid: true, payment_ref: 'REF1' } });
});

it('hides the payment methods after Pay later until Pay now', async () => {
  mockStatus = 'payment_pending';
  await render(<DropoffDetail />);
  expect(screen.queryByText('Pay 20000')).toBeNull();
  expect(screen.queryByText('Pay later')).toBeNull();
  await fireEvent.press(screen.getByText('Pay now'));
  expect(screen.getByText('Pay 20000')).toBeTruthy();
});

it('shows the proof of payment on its own card once paid', async () => {
  mockStatus = 'completed';
  mockProof = { payment_ref: 'REF42', has_payment_photo: true };
  await render(<DropoffDetail />);
  expect(screen.getByText('Your proof of payment')).toBeTruthy();
  expect(screen.getByText('Reference number: REF42')).toBeTruthy();
  expect(screen.getByTestId('dropoff-payment-photo')).toBeTruthy();

  // Tap to zoom, tap again to close.
  await fireEvent.press(screen.getByLabelText('View proof of payment'));
  expect(screen.getByText(/\/dropoffs\/7\/payment-photo$/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('photo-viewer'));
  expect(screen.queryByTestId('photo-viewer')).toBeNull();
});
