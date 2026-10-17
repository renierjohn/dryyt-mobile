import { render } from '@testing-library/react-native';

import { OrderTripMap } from '@/components/order-trip-map';
import type { Order } from '@/lib/types';

const mockMapProps = jest.fn();
jest.mock('@/components/dropoff-map', () => ({
  DropoffMap: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
  PinColor: { customer: 'green', shop: 'blue', driver: 'green' },
}));

const order = {
  id: 9, customer_name: 'Ana', store_name: 'Burger Barn', driver_name: 'Ben',
  customer_lat: 14.56, customer_lng: 121.03, store_lat: 14.55, store_lng: 121.02, driver_lat: 14.552, driver_lng: 121.025,
} as Order;

const pinsShown = () => mockMapProps.mock.lastCall![0].pins.map((p: { key: string; at: object }) => [p.key, p.at]);

beforeEach(() => mockMapProps.mockClear());

it("pins the customer, the store and the driver's last sent location", async () => {
  await render(<OrderTripMap order={order} />);
  expect(pinsShown()).toEqual([
    ['customer', { lat: 14.56, lng: 121.03 }],
    ['store', { lat: 14.55, lng: 121.02 }],
    ['driver', { lat: 14.552, lng: 121.025 }],
  ]);
  expect(mockMapProps.mock.lastCall![0].center).toEqual({ lat: 14.552, lng: 121.025 });
});

it("uses the driver's own phone fix on the driver's screen", async () => {
  await render(<OrderTripMap order={order} driverAt={{ lat: 1, lng: 2 }} />);
  expect(pinsShown()).toContainEqual(['driver', { lat: 1, lng: 2 }]);
});

it('leaves out pins it has no location for', async () => {
  await render(<OrderTripMap order={{ ...order, customer_lat: null, customer_lng: null, driver_lat: null, driver_lng: null }} />);
  expect(pinsShown()).toEqual([['store', { lat: 14.55, lng: 121.02 }]]);
});
