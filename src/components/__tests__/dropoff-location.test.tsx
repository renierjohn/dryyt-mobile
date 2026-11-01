import { fireEvent, render, screen } from '@testing-library/react-native';

import DropoffLocation from '@/app/customer/dropoff/location';
import { ApiError } from '@/lib/api';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (to: unknown) => mockReplace(to) }, useLocalSearchParams: () => ({ storeId: '3' }) }));
jest.mock('@/hooks/use-auth', () => ({ useSignedIn: () => (action: () => void) => action }));
jest.mock('@/hooks/use-location', () => ({ useCurrentLocation: () => ({ loc: { lat: 14.56, lng: 121.03 }, error: null }) }));
jest.mock('@/components/dropoff-map', () => ({ DropoffMap: () => null, PinColor: {} }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/components/app-logo', () => ({ AppLogo: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
let mockCreateError: Error | null = null;
const mockCreate = jest.fn((_input: unknown, opts: { onSuccess: (d: { id: number }) => void; onError?: (e: Error) => void }) =>
  mockCreateError ? opts.onError?.(mockCreateError) : opts.onSuccess({ id: 12 }),
);
jest.mock('@/hooks/queries', () => ({
  useStore: () => ({ data: { name: 'Suds', lat: 14.55, lng: 121.02 }, error: null }),
  useDropoffQuote: () => ({
    data: { road_km: 2, token: 'q', options: [{ vehicle_type: 1, base_fee: 5000, rate_per_km: 1000, total_delivery_fee: 7000, available: true }] },
    variables: { store_id: 3, lat: 14.56, lng: 121.03 },
    isSuccess: true,
    isPending: false,
    error: null,
  }),
  useCreateDropoff: () => ({ mutate: mockCreate, isPending: false, error: mockCreateError }),
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockCreateError = null;
});

const proceed = async () => {
  await render(<DropoffLocation />);
  await fireEvent.press(screen.getByRole('radio'));
  await fireEvent.press(screen.getByText('Proceed'));
};

it('opens the new drop off once booked', async () => {
  await proceed();
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/customer/dropoff/[id]', params: { id: '12' } });
});

it('opens the drop off already running when the customer has one', async () => {
  mockCreateError = new ApiError(409, 'You already have an active drop off', { error: 'You already have an active drop off', active_dropoff_id: 7 });
  await proceed();
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/customer/dropoff/[id]', params: { id: '7' } });
});

it('stays and shows any other error', async () => {
  mockCreateError = new ApiError(400, 'Quote expired');
  await proceed();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByText('Quote expired')).toBeTruthy();
});
