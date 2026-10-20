import { fireEvent, render, screen } from '@testing-library/react-native';

import AvailableJobs from '@/app/driver/index';

const mockSetPickup = jest.fn();
const mockSocketRoom = jest.fn();
let mockPickupOnline = false;
let mockPickupJob: number | null = null;
const job = { id: 3, status: 'pending', store_name: 'Burger Barn', customer_address: '1 Customer St', store_type: 'food', items: [], items_total: 20000, delivery_fee: 7200, service_fee: 800, total_delivery_fee: 8000, notes: '' };

jest.mock('@/constants/features', () => ({ PICKUP_ENABLED: true }));
jest.mock('@/hooks/queries', () => ({
  useDriverMe: () => ({ data: { driver: { online: false, busy: false, pickup_online: mockPickupOnline, pickup_job_id: mockPickupJob }, job: null }, refetch: jest.fn() }),
  useSetPickupOnline: () => ({ mutate: mockSetPickup, isPending: false, error: null }),
  useAvailableJobs: (online: boolean) => ({ data: online ? [job] : undefined, isPending: !online, error: null, refetch: jest.fn() }),
  useActiveJob: () => {
    throw new Error('the Available screen reads busy from /drivers/me, not /jobs/active');
  },
  useAcceptJob: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useSetOnline: () => ({ mutate: jest.fn(), isPending: false }),
  useSavedOnline: () => ({ data: false }),
}));
jest.mock('@/hooks/use-socket', () => ({
  useSocket: (room: string | null) => {
    mockSocketRoom(room);
    return { connected: room !== null, send: jest.fn() };
  },
}));
jest.mock('@/hooks/use-new-job-sound', () => ({ useNewJobSound: () => {} }));
jest.mock('@/components/driver/dropoff-requests', () => ({ DropoffRequests: () => null }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPickupJob = null;
});

it('hides pickup jobs and stays off the job board until Online for Pickup is on', async () => {
  mockPickupOnline = false;
  await render(<AvailableJobs />);
  expect(screen.getByText('Online for Pickup')).toBeTruthy();
  expect(screen.queryByText('Accept job')).toBeNull();
  expect(mockSocketRoom).toHaveBeenLastCalledWith(null);

  await fireEvent(screen.getAllByRole('switch')[1], 'valueChange', true);
  expect(mockSetPickup).toHaveBeenCalledWith(true);
});

it('joins the live job board and lists jobs while online for pickup', async () => {
  mockPickupOnline = true;
  await render(<AvailableJobs />);
  expect(mockSocketRoom).toHaveBeenLastCalledWith('pickups');
  expect(screen.getByText('Accept job')).toBeTruthy();
});

it('disables Accept job while the driver is on a pickup job', async () => {
  mockPickupOnline = true;
  mockPickupJob = 7;
  await render(<AvailableJobs />);
  expect(screen.getByText('Finish your active job before accepting another.')).toBeTruthy();
  expect(screen.getByLabelText('Accept job').props.accessibilityState.disabled).toBe(true);
});
