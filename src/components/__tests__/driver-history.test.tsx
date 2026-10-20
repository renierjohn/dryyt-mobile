import { render, screen, within } from '@testing-library/react-native';

import JobHistory from '@/app/driver/history';

const dropoff = (id: number, status: string, updated_at: string, delivery_fee: number) => ({
  kind: 'dropoff',
  dropoff: { id, status, updated_at, created_at: updated_at, delivery_fee, service_fee: 450, total_delivery_fee: delivery_fee + 450, laundry_fee: null, store_name: 'Shop', customer_name: 'Ana' },
});
jest.mock('@/hooks/queries', () => ({
  useHistory: () => ({
    data: {
      pages: [
        {
          items: [
            dropoff(9, 'owner_confirmed', '2026-10-18 04:00:00', 5000),
            { kind: 'order', order: { id: 8, status: 'delivered', updated_at: '2026-10-18 04:00:00', delivery_fee: 7200, service_fee: 720, total_delivery_fee: 7920 } },
            dropoff(7, 'completed', '2026-10-18 03:00:00', 4000),
            dropoff(6, 'cancelled', '2026-10-17 04:00:00', 9999),
          ],
          next: null,
          earnings: 50000,
        },
      ],
    },
    isPending: false,
    isSuccess: true,
    error: null,
    nextAt: 0,
    refresh: jest.fn(),
  }),
}));
jest.mock('@/components/order-summary', () => ({ OrderSummary: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockSticky = jest.fn();
// The real Screen, recording which children it pins.
jest.mock('@/components/screen', () => {
  const { Screen } = jest.requireActual('@/components/screen');
  return {
    Screen: (props: { stickyHeaderIndices?: number[] }) => {
      mockSticky(props.stickyHeaderIndices);
      return <Screen {...props} />;
    },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it("groups jobs by the day they were finished, shop-confirmed ones first, with the group's earnings on the right", async () => {
  await render(<JobHistory />);
  const titles = screen.getAllByTestId('history-day');
  expect(titles).toHaveLength(3);
  expect(within(titles[0]).getByText('Shop confirmed')).toBeTruthy();
  expect(within(titles[0]).getByText('₱50.00')).toBeTruthy();
  expect(screen.getByText('Sun, Oct 18, 2026')).toBeTruthy();
  // The driver's share of the order (fee minus service fee) plus the drop off's delivery fee.
  expect(screen.getByText('₱112.00')).toBeTruthy();
  // Cancelled jobs earn nothing.
  expect(within(titles[2]).getByText('Sat, Oct 17, 2026')).toBeTruthy();
  expect(within(titles[2]).getByText('₱0.00')).toBeTruthy();
  expect(screen.getByLabelText('Earnings ₱500.00')).toBeTruthy();
});

it("pins each group's title to the top while its jobs scroll by", async () => {
  await render(<JobHistory />);
  // Title, the dev countdown and the error slot sit above the list; then group, job, group, job, job, group, job.
  expect(mockSticky).toHaveBeenLastCalledWith([3, 5, 8]);
});

it("shows each drop off's delivery fee (the driver's share), service fee and total", async () => {
  await render(<JobHistory />);
  expect(screen.getAllByText(/\(You Earn\)/)).toHaveLength(3);
  expect(screen.getAllByText('Service fee')).toHaveLength(3);
  expect(screen.getAllByText('₱4.50')).toHaveLength(3);
  expect(screen.getAllByTestId('dropoff-total-separator')).toHaveLength(3);
  // Delivery fee plus service fee.
  expect(screen.getByText('₱54.50')).toBeTruthy();
  expect(screen.getByText('₱44.50')).toBeTruthy();
});
