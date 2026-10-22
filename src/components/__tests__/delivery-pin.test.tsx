import { render, screen } from '@testing-library/react-native';

import { DeliveryPinCard, useDeliveryPin } from '@/components/delivery-pin';

let mockLoc: { loc: object | null; error: string | null } = { loc: null, error: null };
jest.mock('@/hooks/use-location', () => ({ useCurrentLocation: () => ({ ...mockLoc, accuracy: null }) }));
jest.mock('@/hooks/queries', () => ({
  useOrderQuote: () => ({ mutate: jest.fn(), isPending: false, isSuccess: false, error: null, data: undefined, variables: undefined }),
  useStore: () => ({ data: { lat: 14.55, lng: 121.02 }, error: null }),
  useRoadRoute: () => ({ data: undefined }),
}));
jest.mock('@/components/dropoff-map', () => ({ DropoffMap: () => null, PinColor: {} }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));

function Card() {
  return <DeliveryPinCard storeName="Suds" pin={useDeliveryPin(4)} />;
}

it('spins before Compute Delivery Fee while finding the location, and stops once found or failed', async () => {
  const { rerender } = await render(<Card />);
  expect(screen.getByTestId('button-waiting')).toBeTruthy();
  expect(screen.getByText('Compute Delivery Fee')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Compute Delivery Fee' })).toBeDisabled();

  mockLoc = { loc: { lat: 14.56, lng: 121.03 }, error: null };
  await rerender(<Card />);
  expect(screen.queryByTestId('button-waiting')).toBeNull();
  expect(screen.getByRole('button', { name: 'Compute Delivery Fee' })).toBeEnabled();

  mockLoc = { loc: null, error: 'Allow location access to use drop off.' };
  await rerender(<Card />);
  expect(screen.queryByTestId('button-waiting')).toBeNull();
});
