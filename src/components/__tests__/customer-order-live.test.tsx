import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import OrderScreen from '@/app/customer/order/[id]';

const mockSocketRoom = jest.fn();
const mockCancel = jest.fn();
let mockStatus = 'pending';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '12' }) }));
jest.mock('@/hooks/queries', () => ({
  useOrder: () => ({
    data: {
      id: 12, status: mockStatus, store_type: 'food', store_name: 'Burger Barn', store_address: '1 St', customer_address: 'Here',
      items: [], items_total: 20000, delivery_fee: 7200, service_fee: 800, total_delivery_fee: 8000, notes: '', driver_name: null,
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useCancelOrder: () => ({ mutate: mockCancel, isPending: false, error: null }),
  usePlaceOrder: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
jest.mock('@/hooks/use-cart', () => ({ useCart: () => ({ orderId: null, clear: jest.fn() }) }));
jest.mock('@/hooks/use-socket', () => ({
  useSocket: (room: string | null) => {
    mockSocketRoom(room);
    return { connected: room !== null, send: jest.fn() };
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn() }) }));
jest.mock('@/components/order-trip-map', () => ({ OrderTripMap: () => null }));
jest.mock('@/components/driver-details', () => ({ DriverDetails: () => null }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it.each([
  ['awaiting_payment', 'order-12'],
  ['payment_confirmed', 'order-12'],
  ['pending', 'order-12'],
  ['accepted', 'order-12'],
  ['picked_up', 'order-12'],
  ['delivered', null],
  ['cancelled', null],
])('while %s, the order socket is %s', async (status, room) => {
  mockStatus = status;
  await render(<OrderScreen />);
  expect(mockSocketRoom).toHaveBeenLastCalledWith(room);
});

describe('Cancel order', () => {
  beforeEach(() => {
    mockCancel.mockClear();
    jest.spyOn(Alert, 'alert').mockClear();
  });

  it('cancels at once before anything was paid', async () => {
    mockStatus = 'awaiting_fee';
    await render(<OrderScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel order' }));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalled();
  });

  it.each(['awaiting_payment', 'payment_confirmed', 'pending'])('asks first once paid (%s), saying the money is not refunded', async (status) => {
    mockStatus = status;
    await render(<OrderScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel order' }));
    expect(mockCancel).not.toHaveBeenCalled();
    const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls[0];
    expect(title).toBe('Cancel a paid order?');
    expect(message).toContain('You already paid ₱280.00 to Burger Barn');
    buttons!.find((b) => b.text === 'Cancel order')!.onPress!();
    expect(mockCancel).toHaveBeenCalled();
  });
});
