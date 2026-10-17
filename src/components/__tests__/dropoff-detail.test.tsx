import { render, screen, within } from '@testing-library/react-native';

import DropoffDetail from '@/app/customer/dropoff/[id]';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useLocalSearchParams: () => ({ id: '7' }) }));
jest.mock('@/hooks/use-socket', () => ({ useSocket: () => ({ connected: false }) }));
jest.mock('@/components/driver-details', () => ({ DriverDetails: () => null }));
jest.mock('@/components/dropoff-map', () => ({ DropoffMap: () => null, PinColor: {} }));
jest.mock('@/hooks/queries', () => ({
  useDropoff: () => ({
    data: {
      id: 7, status: 'searching', store_id: 1, store_name: 'Shop', customer_lat: 0, customer_lng: 0, shop_lat: 0, shop_lng: 0,
      customer_address: 'Here', total_delivery_fee: 5000,
    },
    refetch: jest.fn(),
  }),
  useDropoffAction: () => ({ mutate: jest.fn(), isPending: false, error: new Error('Cancel failed') }),
  useCreateDropoff: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useRoadRoute: () => ({ data: undefined }),
}));
// Split the screen so the test can tell scroll content from the sticky footer.
jest.mock('@/components/screen', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    Screen: ({ children, footer }: { children: unknown; footer: unknown }) =>
      createElement(View, null, createElement(View, { testID: 'body' }, children), createElement(View, { testID: 'footer' }, footer)),
  };
});

it('shows action errors next to the buttons in the footer', async () => {
  await render(<DropoffDetail />);
  expect(within(screen.getByTestId('footer')).getByText('Cancel failed')).toBeTruthy();
});
