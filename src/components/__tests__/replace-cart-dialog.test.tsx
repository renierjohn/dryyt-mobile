import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { CartProvider, useCart } from '@/hooks/use-cart';
import type { MenuItem } from '@/lib/types';

jest.mock('@/components/icon', () => ({ Icon: () => null }));

const item: MenuItem = { id: 1, name: 'Tea', price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, popularity: 0 };

/** Puts one Tea Haven line in the cart, then asks to replace it. */
function Asker({ onConfirm }: { onConfirm: () => void }) {
  const cart = useCart();
  useEffect(() => {
    cart.add(item, { id: 1, name: 'Tea Haven' }, 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return cart.store ? <AskButton onConfirm={onConfirm} /> : null;
}
function AskButton({ onConfirm }: { onConfirm: () => void }) {
  const cart = useCart();
  useEffect(() => cart.confirmReplace(onConfirm), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const ask = (onConfirm = jest.fn()) =>
  render(
    <CartProvider>
      <Asker onConfirm={onConfirm} />
    </CartProvider>,
  );

it('asks in an in-app dialog, not a system alert, naming the current store', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await ask();
  expect(screen.getByText('Start a new cart?')).toBeTruthy();
  expect(screen.getByText('Your cart from Tea Haven will be cleared.')).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
});

it('Start new cart confirms and closes', async () => {
  const onConfirm = jest.fn();
  await ask(onConfirm);
  await fireEvent.press(screen.getByText('Start new cart'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Start a new cart?')).toBeNull();
});

it('Keep my cart cancels', async () => {
  const onConfirm = jest.fn();
  await ask(onConfirm);
  await fireEvent.press(screen.getByText('Keep my cart'));
  expect(screen.queryByText('Start a new cart?')).toBeNull();
  expect(onConfirm).not.toHaveBeenCalled();
});

it('tapping outside the card cancels', async () => {
  const onConfirm = jest.fn();
  await ask(onConfirm);
  await fireEvent.press(screen.getByTestId('replace-cart-backdrop'));
  expect(screen.queryByText('Start a new cart?')).toBeNull();
  expect(onConfirm).not.toHaveBeenCalled();
});
