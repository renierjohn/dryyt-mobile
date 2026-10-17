import { fireEvent, render, screen } from '@testing-library/react-native';

import ActiveJob from '@/app/driver/active';

const mockAdvance = jest.fn();
// Customer pin at 14.5600, 121.0300; 0.001° of latitude is about 111 m.
const job = {
  id: 5, status: 'picked_up', store_name: 'Burger Barn', customer_address: 'Pinned location 14.56000, 121.03000', store_type: 'food', customer_name: 'Ana', customer_phone: '0917',
  customer_lat: 14.56, customer_lng: 121.03, store_lat: null, store_lng: null, driver_lat: null, driver_lng: null,
  items: [], items_total: 20000, delivery_fee: 8000, service_fee: 800, notes: '',
};
let mockFix: { lat: number; lng: number } | null = null;

jest.mock('@/constants/features', () => ({ PICKUP_ENABLED: true }));
jest.mock('@/hooks/queries', () => ({
  useDriverMe: () => ({ data: { job: null }, refetch: jest.fn() }),
  useActiveJob: () => ({ data: job, isPending: false, error: null, refetch: jest.fn() }),
  useAdvanceJob: () => ({ mutate: mockAdvance, isPending: false, error: null }),
  useReleaseJob: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
const mockSend = jest.fn();
const mockSocketRoom = jest.fn();
jest.mock('@/hooks/use-socket', () => ({
  useSocket: (room: string | null) => {
    mockSocketRoom(room);
    return { connected: true, send: mockSend };
  },
}));
jest.mock('@/hooks/use-location', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useWatchLocation: (enabled: boolean, onLocation: (at: object) => void) =>
      useEffect(() => {
        if (enabled && mockFix) onLocation(mockFix);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [enabled]),
  };
});
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }) }));
jest.mock('@/components/order-trip-map', () => ({ OrderTripMap: () => null }));
jest.mock('@/components/driver/dropoff-trip', () => ({ DropoffTrip: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const deliverDisabled = () => screen.getByLabelText('Delivered to customer').props.accessibilityState.disabled;

beforeEach(() => jest.clearAllMocks());

it('keeps Delivered locked while the driver is 200 m or more from the customer', async () => {
  mockFix = { lat: 14.563, lng: 121.03 }; // ~334 m
  await render(<ActiveJob />);
  expect(screen.getByText('334 m from the customer. Get within 200 m to deliver.')).toBeTruthy();
  expect(deliverDisabled()).toBe(true);
});

it('unlocks Delivered within 200 m of the customer', async () => {
  mockFix = { lat: 14.561, lng: 121.03 }; // ~111 m
  await render(<ActiveJob />);
  expect(screen.getByText('You are at the customer.')).toBeTruthy();
  expect(deliverDisabled()).toBe(false);
  await fireEvent.press(screen.getByText('Delivered to customer'));
  expect(mockAdvance).toHaveBeenCalledWith({ id: 5, status: 'delivered' });
});

it('waits for a location fix before unlocking', async () => {
  mockFix = null;
  await render(<ActiveJob />);
  expect(screen.getByText('Waiting for your location…')).toBeTruthy();
  expect(deliverDisabled()).toBe(true);
});

it("joins the order's room and sends the driver's location over it once picked up", async () => {
  mockFix = { lat: 14.561, lng: 121.03 };
  await render(<ActiveJob />);
  expect(mockSocketRoom).toHaveBeenLastCalledWith('order-5');
  expect(mockSend).toHaveBeenCalledWith({ t: 'loc', lat: 14.561, lng: 121.03 });
});
