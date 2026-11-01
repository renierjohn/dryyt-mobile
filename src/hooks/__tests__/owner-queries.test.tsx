import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useOwnerDropoffs, useOwnerOrders, usePayouts, usePickupPayouts, useSaveMenuItem, useServiceFees, useServiceFeeWeeks, currentFeeWeek } from '@/hooks/queries';

// Screen focus like react-navigation's: focus and blur run the useFocusEffect callbacks without re-rendering.
let mockFocused = true;
const mockFocusEffects = new Set<{ run: () => void; stop: () => void }>();
const setFocused = (focused: boolean) =>
  act(async () => {
    mockFocused = focused;
    mockFocusEffects.forEach((e) => (focused ? e.run() : e.stop()));
  });
const mockApi = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useIsFocused: () => mockFocused,
    useFocusEffect: (callback: () => (() => void) | void) =>
      useEffect(() => {
        let cleanup: (() => void) | void;
        const effect = {
          run: () => {
            cleanup = callback();
          },
          stop: () => {
            cleanup?.();
            cleanup = undefined;
          },
        };
        mockFocusEffects.add(effect);
        if (mockFocused) effect.run();
        return () => {
          effect.stop();
          mockFocusEffects.delete(effect);
        };
      }, [callback]),
  };
});
jest.mock('@/lib/api', () => ({ api: (path: string) => mockApi(path), uploadImage: jest.fn() }));
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({}) }));
jest.mock('@/lib/session-storage', () => ({ loadOnline: jest.fn(), saveOnline: jest.fn() }));
jest.mock('@/lib/shrink-image', () => ({ shrinkImage: jest.fn() }));
jest.mock('@/lib/road-route', () => ({ roadRoute: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  mockApi.mockReset().mockResolvedValue({ orders: [], payouts: [], dropoffs: [], fees: [], weeks: [], next: null });
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
  const { result } = await renderHook(() => useList(), { wrapper });
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
  await setFocused(false);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(mockApi).toHaveBeenCalledTimes(1);

  // Back on the screen: one load.
  await setFocused(true);
  await act(async () => {});
  expect(mockApi).toHaveBeenCalledTimes(2);

  // Away and straight back: under 5 s since that load, so no request.
  await setFocused(false);
  await setFocused(true);
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

it("names the Manila week like the worker: Sunday 23:59 Manila is still last week's", () => {
  expect(currentFeeWeek(Date.parse('2026-10-18T15:59:00Z'))).toBe('2026-10-12');
  expect(currentFeeWeek(Date.parse('2026-10-18T16:00:00Z'))).toBe('2026-10-19');
  expect(currentFeeWeek(Date.parse('2026-10-21T02:00:00Z'))).toBe('2026-10-19');
});

describe('service fee weeks', () => {
  // Wed Oct 21 2026, 10:00 Manila: the current week starts Mon Oct 19.
  const NOW = new Date('2026-10-21T02:00:00Z');
  const setup = () => {
    jest.setSystemTime(NOW);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { wrapper };
  };
  const calls = (path: string) => mockApi.mock.calls.filter(([p]) => p === path).length;

  it('loads a past week once: not again when reopened, revisited, pulled or much later', async () => {
    const { wrapper } = setup();
    const path = '/owner/service-fees?week=2026-10-12';
    // The week's lines (mounted while open) and the totals (for pull to refresh).
    const week = await renderHook(() => useServiceFees('2026-10-12'), { wrapper });
    const weeks = await renderHook(() => useServiceFeeWeeks(), { wrapper });
    await act(async () => {});
    expect(calls(path)).toBe(1);

    // Collapsed, then opened again 10 min later.
    await week.unmount();
    await act(async () => jest.advanceTimersByTime(10 * 60_000));
    await renderHook(() => useServiceFees('2026-10-12'), { wrapper });
    await act(async () => {});
    expect(calls(path)).toBe(1);

    // Away from the screen and back, and a pull to refresh.
    await setFocused(false);
    await setFocused(true);
    await act(async () => {
      await weeks.result.current.refresh();
    });
    expect(calls(path)).toBe(1);
  });

  it('keeps reloading the current week, which still gets new lines', async () => {
    const { wrapper } = setup();
    const path = '/owner/service-fees?week=2026-10-19';
    const week = await renderHook(() => useServiceFees('2026-10-19'), { wrapper });
    await act(async () => {});
    expect(calls(path)).toBe(1);

    await week.unmount();
    await act(async () => jest.advanceTimersByTime(5_000));
    await renderHook(() => useServiceFees('2026-10-19'), { wrapper });
    await act(async () => {});
    expect(calls(path)).toBe(2);
  });
});

it('saving a menu item updates it in the cached menu without reloading the store; the other items stay as they were', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const dish = (id: number, sold_out = false) => ({ id, name: `Dish ${id}`, sold_out });
  const other = dish(1);
  client.setQueryData(['store', 4], { id: 4, menu: [other, dish(2)] });
  mockApi.mockReset().mockResolvedValue({ item: dish(2, true) });

  const save = await renderHook(() => useSaveMenuItem(4, 2), { wrapper });
  await act(async () => {
    await save.result.current.mutateAsync({ sold_out: true } as never);
  });
  expect(mockApi).toHaveBeenCalledTimes(1);
  const menu = client.getQueryData<{ menu: { id: number; sold_out: boolean }[] }>(['store', 4])!.menu;
  expect(menu.map((m) => m.sold_out)).toEqual([false, true]);
  expect(menu[0]).toBe(other);
});

it.each([
  ['owner drop offs', useOwnerDropoffs],
  ['owner food orders', () => useOwnerOrders('food')],
  ['shop payouts', usePayouts],
  ['laundry pickup payouts', () => usePickupPayouts('laundry')],
])("doesn't re-render %s when a reload brings back the same list", async (_name, useList) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  let renders = 0;
  const { result } = await renderHook(
    () => {
      renders += 1;
      return useList();
    },
    { wrapper },
  );
  // React Query hands results over on a timer (fake here): flush it after each step.
  const settle = () => act(async () => jest.advanceTimersByTime(10));
  await settle();
  expect(result.current.isSuccess).toBe(true);
  const before = renders;

  await act(async () => jest.advanceTimersByTime(5_000));
  await act(async () => {
    await result.current.refresh();
  });
  await settle();
  expect(mockApi).toHaveBeenCalledTimes(2);
  expect(renders).toBe(before);
});

it.each([
  ['owner drop offs', useOwnerDropoffs, '/owner/transactions'],
  ['shop payouts', usePayouts, '/owner/payouts'],
])("doesn't re-render %s when its tab is left or opened again, and loads only when it's due", async (_name, useList, path) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  let renders = 0;
  await renderHook(
    () => {
      renders += 1;
      return useList();
    },
    { wrapper },
  );
  await act(async () => jest.advanceTimersByTime(10));
  const before = renders;

  // Another tab and straight back: no request, no render.
  await setFocused(false);
  await setFocused(true);
  await act(async () => jest.advanceTimersByTime(10));
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(renders).toBe(before);

  // Another owner screen refreshes the same list while this tab is hidden: it waits for the next visit.
  await setFocused(false);
  await act(async () => client.invalidateQueries({ queryKey: ['owner'] }));
  await act(async () => jest.advanceTimersByTime(10));
  expect(mockApi).toHaveBeenCalledTimes(1);
  await setFocused(true);
  await act(async () => jest.advanceTimersByTime(10));
  expect(mockApi).toHaveBeenCalledTimes(2);
  expect(mockApi).toHaveBeenLastCalledWith(path);
  // Same list back: still no render.
  expect(renders).toBe(before);
});
