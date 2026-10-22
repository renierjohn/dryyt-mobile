import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import Payouts from '@/app/owner/(tabs)/payouts';

const mockSticky = jest.fn();
const mockPayout = (id: number, payee_type: 'driver' | 'developer', payee_id: number | null) => ({
  id, transaction_id: id, payee_type, payee_id, payee_name: payee_id ? 'Ben' : null, store_name: 'Shop', amount: 5000,
  status: 'pending', paid_at: null, created_at: '2026-10-17 04:00:00', payee_has_face: payee_id !== null, payee_photo_version: 'v1', driver_name: 'Ben',
});
const mockList = (key: string, items: object[]) => ({
  data: { pages: [{ [key]: items, next: null }] }, isPending: false, isSuccess: true, error: null, hasNextPage: false, refresh: jest.fn(), nextAt: 0,
});
const mockMutation = { mutate: jest.fn(), isPending: false, error: null };
jest.mock('@/hooks/queries', () => ({
  usePayouts: () => mockList('payouts', [mockPayout(1, 'developer', null), mockPayout(2, 'driver', 9)]),
  // The same driver in both driver sections.
  usePickupPayouts: (type: string) =>
    mockList('payouts', [
      { id: type === 'food' ? 31 : 24, store_id: 1, store_name: 'Shop', driver_id: 9, driver_name: 'Ben', amount: 7600, paid_at: null, updated_at: '2026-10-17 04:00:00', driver_has_face: false, driver_photo_version: '' },
      { id: type === 'food' ? 30 : 23, store_id: 1, store_name: 'Shop', driver_id: 9, driver_name: 'Ben', amount: 2400, paid_at: '2026-10-17 06:00:00', updated_at: '2026-10-17 03:00:00', driver_has_face: false, driver_photo_version: '' },
    ]),
  useOwnerAppFee: () => ({
    data: {
      month: '2026-10',
      stores: [
        { id: 1, name: 'Suds', type: 'laundry', store_logo: null, fee_type: 2, fee_flat: 0, fee_percentage: 10, sales: 25050, amount_due: 2600 },
        { id: 2, name: 'Tea Haven', type: 'food', store_logo: 'https://img.test/tea.png', fee_type: 1, fee_flat: 50000, fee_percentage: 0, sales: 0, amount_due: 50000 },
      ],
      last_payment: { amount: 60000, type: 'both', payment_type: 'gcash', date_paid: '2026-09-01', next_due_date: '2026-10-01' },
    },
    error: null,
    refetch: jest.fn(),
  }),
  useMarkPayoutPaid: () => mockMutation,
  useMarkPickupPaid: () => mockMutation,
}));
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
// Slides finish at once, so a swipe lands on its tab straight away.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (v: number) => ({ value: v, get() { return this.value; }, set(n: number) { this.value = n; } }),
    useAnimatedStyle: () => ({}),
    withTiming: (to: number, _opts?: object, done?: (finished: boolean) => void) => (done?.(true), to),
  };
});
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (...a: unknown[]) => void, ...args: unknown[]) => fn(...args) }));
// The swipe handler, captured so a test can fire it.
let mockSwipeEnd: ((e: { translationX: number }) => void) | undefined;
jest.mock('react-native-gesture-handler', () => {
  const pan = {
    activeOffsetX: () => pan,
    failOffsetY: () => pan,
    onUpdate: () => pan,
    onEnd: (fn: (e: { translationX: number }) => void) => ((mockSwipeEnd = fn), pan),
  };
  return { Gesture: { Pan: () => pan }, GestureDetector: ({ children }: { children: unknown }) => children };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it('shows one section per tab under the title, the tabs pinned while it scrolls', async () => {
  await render(<Payouts />);
  expect(mockSticky).toHaveBeenLastCalledWith([1]);
  expect(screen.getByText("The app's commission on each drop off.")).toBeTruthy();
  expect(screen.queryByText('Mark paid')).toBeNull();

  expect(['APP Fee', 'Dropoff', 'Pickup', 'Orders'].map((t) => screen.getByText(t))).toHaveLength(4);
  expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityState.selected)).toEqual([true, false, false, false]);
  await fireEvent.press(screen.getByText('Dropoff'));
  expect(screen.getAllByText('Mark paid')).toHaveLength(1);
  expect(screen.getByText('#2')).toBeTruthy();
  // The driver's face, from the owner endpoint.
  expect([screen.getByTestId('driver-face-payout-2').props.source].flat()[0]).toMatchObject({ uri: expect.stringContaining('/owner/drivers/9/face?v=v1') });

  await fireEvent.press(screen.getByText('Pickup'));
  // One day: its total counts only the paid payout; each line reads order, driver and time over shop and status.
  expect(screen.getAllByTestId('payout-day')).toHaveLength(1);
  expect(within(screen.getByTestId('payout-day')).getByText('₱24.00')).toBeTruthy();
  const line = within(screen.getByTestId('payout-line-pickup-24'));
  expect(line.getByText('#24')).toBeTruthy();
  expect(line.getByText(/^Ben · /)).toBeTruthy();
  expect(line.getByText('₱76.00')).toBeTruthy();
  expect(line.getByText('Shop')).toBeTruthy();
  expect(line.getByText('Pending')).toBeTruthy();
  expect(within(screen.getByTestId('payout-line-pickup-23')).getByText('Paid')).toBeTruthy();
  expect(screen.getAllByText('Mark paid')).toHaveLength(1);

  await fireEvent.press(screen.getByText('Orders'));
  expect(screen.getAllByText('Mark paid')).toHaveLength(1);
  expect(screen.getByText('#31')).toBeTruthy();
});

it('swipes left or right to the next or previous tab, stopping at the ends', async () => {
  await render(<Payouts />);
  const selected = () => screen.getAllByRole('tab').findIndex((t) => t.props.accessibilityState.selected);
  await act(async () => mockSwipeEnd!({ translationX: 30 })); // too short
  expect(selected()).toBe(0);
  await act(async () => mockSwipeEnd!({ translationX: 100 })); // nothing before the first
  expect(selected()).toBe(0);
  for (const i of [1, 2, 3, 3]) {
    await act(async () => mockSwipeEnd!({ translationX: -100 }));
    expect(selected()).toBe(i);
  }
  await act(async () => mockSwipeEnd!({ translationX: 100 }));
  expect(selected()).toBe(2);
});

it("APP Fee shows this month's amount due per store, the last payment, and weekly service fees by drop off and driver", async () => {
  await render(<Payouts />);
  expect(screen.getByText('Month of October 2026')).toBeTruthy();
  const suds = within(screen.getByTestId('month-store-1'));
  expect(suds.getByText('10% of ₱250.50 sales')).toBeTruthy();
  expect(suds.getByText('₱26.00')).toBeTruthy();
  const tea = within(screen.getByTestId('month-store-2'));
  expect(tea.getByText('Flat fee')).toBeTruthy();
  expect(tea.getByText('₱500.00')).toBeTruthy();
  expect([screen.getByTestId('month-store-logo-2').props.source].flat()).toEqual([{ uri: 'https://img.test/tea.png' }]);

  const last = within(screen.getByTestId('last-payment'));
  expect(last.getByText('Date paid Sep 1, 2026 · Service fee & Subscription · ₱600.00')).toBeTruthy();
  expect(last.getByText('₱600.00')).toBeTruthy();
  expect(last.getByText('gcash')).toBeTruthy();
  expect(last.getByText('Next due: Oct 1, 2026')).toBeTruthy();

  expect(screen.getAllByTestId('fee-week')).toHaveLength(1);
  const line = within(screen.getByTestId('fee-line-payout-1'));
  expect(line.getByText('#1')).toBeTruthy();
  expect(line.getByText('Ben')).toBeTruthy();
});
