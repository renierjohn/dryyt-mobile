import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useOwnerDropoffs, useOwnerOrders, usePayouts, usePickupPayouts } from '@/hooks/queries';

let mockFocused = true;
const mockApi = jest.fn();
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused, useFocusEffect: () => {} }));
jest.mock('@/lib/api', () => ({ api: (path: string) => mockApi(path), uploadImage: jest.fn() }));
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({}) }));
jest.mock('@/lib/session-storage', () => ({ loadOnline: jest.fn(), saveOnline: jest.fn() }));
jest.mock('@/lib/shrink-image', () => ({ shrinkImage: jest.fn() }));
jest.mock('@/lib/road-route', () => ({ roadRoute: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  mockApi.mockReset().mockResolvedValue({ orders: [], payouts: [], dropoffs: [], next: null });
});
afterEach(() => {
  focusManager.setFocused(undefined);
  jest.useRealTimers();
});

it.each([
  ['owner drop offs', useOwnerDropoffs, '/owner/transactions'],
  ['owner food orders', () => useOwnerOrders('food'), '/owner/orders?type=food'],
  ['owner laundry pickups', () => useOwnerOrders('laundry'), '/owner/orders?type=laundry'],
  ['shop payouts', usePayouts, '/owner/payouts'],
  ['laundry pickup payouts', () => usePickupPayouts('laundry'), '/owner/pickup-payouts?type=laundry'],
  ['food order payouts', () => usePickupPayouts('food'), '/owner/pickup-payouts?type=food'],
])('loads %s on each visit or pull, at most once per 5 s, never by polling', async (_name, useList, path) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, rerender } = await renderHook(() => useList(), { wrapper });
  await act(async () => {});
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(mockApi).toHaveBeenLastCalledWith(path);

  // Pull to refresh within 5 s of the last load: skipped.
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockApi).toHaveBeenCalledTimes(1);

  // Staying on the screen: no polling.
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(mockApi).toHaveBeenCalledTimes(1);

  // Another tab, then back to the app: nothing while the screen is hidden.
  mockFocused = false;
  await rerender({});
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(mockApi).toHaveBeenCalledTimes(1);

  // Back on the screen: one load.
  mockFocused = true;
  await rerender({});
  await act(async () => {});
  expect(mockApi).toHaveBeenCalledTimes(2);

  // Away and straight back: under 5 s since that load, so no request.
  mockFocused = false;
  await rerender({});
  mockFocused = true;
  await rerender({});
  await act(async () => {});
  expect(mockApi).toHaveBeenCalledTimes(2);
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockApi).toHaveBeenCalledTimes(2);

  // Once 5 s have passed, a pull loads again.
  await act(async () => jest.advanceTimersByTime(5_000));
  await act(async () => {
    await result.current.refresh();
  });
  expect(mockApi).toHaveBeenCalledTimes(3);
});
