import { render } from '@testing-library/react-native';

import OrderScreen from '@/app/customer/order/[id]';

const mockSocketRoom = jest.fn();
let mockStatus = 'pending';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '12' }) }));
jest.mock('@/hooks/queries', () => ({
  useOrder: () => ({
    data: {
      id: 12, status: mockStatus, store_type: 'food', store_name: 'Burger Barn', store_address: '1 St', customer_address: 'Here',
      items: [], items_total: 20000, delivery_fee: 8000, service_fee: 800, notes: '', driver_name: null,
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useCancelOrder: () => ({ mutate: jest.fn(), isPending: false, error: null }),
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
