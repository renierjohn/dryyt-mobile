import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { CartProvider, useCart } from '@/hooks/use-cart';
import type { MenuItem } from '@/lib/types';

const item = (id: number, price: number, discount_percent = 0): MenuItem => ({
  id, name: `Item ${id}`, price, discount_percent, image_url: null, category: '', best_seller: false, sold_out: false, popularity: 0,
});
const tea = { id: 1, name: 'Tea Haven' };
const burger = { id: 2, name: 'Burger Barn' };
const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

it('adds items from one store and totals discounted prices', async () => {
  const { result } = await renderHook(() => useCart(), { wrapper });
  await act(() => {
    expect(result.current.add(item(1, 10000), tea, 2)).toBe('added');
    result.current.add(item(2, 5000, 20), tea, 1);
    result.current.add(item(1, 10000), tea, 1);
  });
  expect(result.current.store).toEqual(tea);
  expect(result.current.count).toBe(4);
  expect(result.current.qtyOf(1)).toBe(3);
  expect(result.current.itemsTotal).toBe(3 * 10000 + 4000);
});

it('asks before mixing stores, and replace starts over', async () => {
  const { result } = await renderHook(() => useCart(), { wrapper });
  await act(() => {
    result.current.add(item(1, 10000), tea, 1);
  });
  let outcome = '';
  await act(() => {
    outcome = result.current.add(item(5, 15000), burger, 1);
  });
  expect(outcome).toBe('needs-replace');
  expect(result.current.store).toEqual(tea);

  await act(() => result.current.replace(item(5, 15000), burger, 2));
  expect(result.current.store).toEqual(burger);
  expect(result.current.lines).toEqual([{ item: item(5, 15000), qty: 2 }]);
});

it('setQty clamps, removes at 0, and an empty cart has no store', async () => {
  const { result } = await renderHook(() => useCart(), { wrapper });
  await act(() => {
    result.current.add(item(1, 10000), tea, 1);
  });
  await act(() => result.current.setQty(1, 99));
  expect(result.current.qtyOf(1)).toBe(50);
  await act(() => result.current.setQty(1, 0));
  expect(result.current.lines).toEqual([]);
  expect(result.current.store).toBeNull();
});
