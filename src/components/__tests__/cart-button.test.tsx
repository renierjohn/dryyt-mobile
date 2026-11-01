import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { CartButton } from '@/components/cart-button';
import { CartProvider, useCart } from '@/hooks/use-cart';

let mockFocused = true;
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => mockFocused }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// Counts the pill's renders.
const mockPillRender = jest.fn();
jest.mock('@/components/themed-text', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return { ThemedText: (props: { children: unknown }) => (mockPillRender(), <RNText {...props} />) };
});

const dish = { id: 5, name: 'Dish 5', price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, sold_out: false, popularity: 0 };

/** The store page above, adding to the cart. */
function AddOne() {
  const cart = useCart();
  return (
    <Pressable testID="add" onPress={() => cart.add(dish, { id: 2, name: 'Burger Barn' }, 1)}>
      <Text>add</Text>
    </Pressable>
  );
}

const renderBoth = () =>
  render(
    <CartProvider>
      <AddOne />
      <CartButton />
    </CartProvider>,
  );

beforeEach(() => {
  mockFocused = true;
  mockPillRender.mockClear();
});

it('shows the count and total on its own screen', async () => {
  await renderBoth();
  await fireEvent.press(screen.getByTestId('add'));
  expect(screen.getByText('1 item · ₱100.00')).toBeTruthy();
});

it('stays out of the way while its screen is under another one: the cart changing there renders nothing here', async () => {
  mockFocused = false;
  await renderBoth();
  await fireEvent.press(screen.getByTestId('add'));
  await fireEvent.press(screen.getByTestId('add'));
  expect(mockPillRender).not.toHaveBeenCalled();
});
