import { render } from '@testing-library/react-native';

import Orders from '@/app/owner/(tabs)/orders';

const order = (id: number) => ({
  id, type: 'pickup', status: 'delivered', store_id: 1, store_type: 'food', store_name: 'Tea Haven', store_address: '12 Mabini St',
  customer_address: 'Pinned location', notes: '', items: [], items_total: 20000, delivery_fee: 7920, total_delivery_fee: 7920,
  payment_ref: '', payment_photo_key: null, created_at: '2026-10-17 04:00:00',
});
// One loaded list, the same objects on every render, as React Query keeps them when nothing changed.
const mockList = {
  data: { pages: [{ orders: [order(3), order(2), order(1)], next: null }] },
  isPending: false, isSuccess: true, error: null, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: jest.fn(), refresh: jest.fn(),
};
const mockConfirm = { mutate: jest.fn(), isPending: false, error: null };
jest.mock('@/hooks/queries', () => ({
  useOwnerOrders: () => mockList,
  useConfirmPayment: () => ({ ...mockConfirm }),
  useRejectPayment: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useSetLaundryFee: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
// Counts card renders.
const mockCardRender = jest.fn();
jest.mock('@/components/card', () => ({ Card: ({ children }: { children: unknown }) => (mockCardRender(), children) }));
jest.mock('@/components/photo-viewer', () => ({ PhotoViewer: () => null }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/components/app-logo', () => ({ AppLogo: () => null }));
jest.mock('@/lib/api', () => ({ apiUrl: (p: string) => `https://api.test${p}`, authHeaders: () => ({}) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it("re-renders the tab without redrawing its order cards when the orders didn't change (e.g. on a visit)", async () => {
  const view = await render(<Orders />);
  expect(mockCardRender).toHaveBeenCalledTimes(3);
  mockCardRender.mockClear();

  await view.rerender(<Orders />);
  expect(mockCardRender).not.toHaveBeenCalled();
});
