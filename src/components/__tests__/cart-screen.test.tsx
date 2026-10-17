import { render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import CartScreen from '@/app/customer/cart';
import { CartProvider, useCart } from '@/hooks/use-cart';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('@/hooks/queries', () => ({ useCreateOrder: () => ({ mutate: jest.fn(), isPending: false, error: null }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const item = { id: 1, name: 'Milk Tea', price: 10000, image_url: 'https://img.test/tea.jpg', discount_percent: 0, category: 'Drinks', best_seller: false, popularity: 0 };

function Harness() {
  const cart = useCart();
  useEffect(() => {
    cart.add(item, { id: 1, name: 'Tea Haven' }, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <CartScreen />;
}

it('labels the footer amount as items only, plus delivery fee', async () => {
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect(screen.getByText('Items ₱200.00 + delivery fee')).toBeTruthy();
});

it('shows each line with its menu photo', async () => {
  await render(
    <CartProvider>
      <Harness />
    </CartProvider>,
  );
  expect([screen.getByTestId('cart-line-photo-1').props.source].flat()).toEqual([{ uri: 'https://img.test/tea.jpg' }]);
});

