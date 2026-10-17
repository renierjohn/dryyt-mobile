import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import MenuItemScreen from '@/app/customer/menu/[id]';
import { CartProvider } from '@/hooks/use-cart';

const mockDish = (id: number) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: id === 1, popularity: 0,
});
// Menu as the worker returns it: already in the owner's sort_order (not id order).
const mockMenu = [3, 1, 9, 4, 8, 2, 7, 5, 6].map(mockDish);

jest.mock('@/hooks/queries', () => ({
  useStore: () => ({ data: { id: 2, name: 'Burger Barn', menu: mockMenu }, isPending: false, error: null }),
}));
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn() },
    useLocalSearchParams: () => ({ id: '1', storeId: '2' }),
    Stack: { Screen: () => createElement('View') },
  };
});
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const renderItem = () =>
  render(
    <CartProvider>
      <MenuItemScreen />
    </CartProvider>,
  );

it("shows the store's other dishes in sort order, at most 6, then More to the store page", async () => {
  await renderItem();
  expect(screen.getByText('More from Burger Barn')).toBeTruthy();
  // Dish 1 is the one being viewed; the next six in sort order are 3, 9, 4, 8, 2, 7.
  const shown = [3, 9, 4, 8, 2, 7].map((id) => screen.getByText(`Dish ${id}`));
  expect(shown).toHaveLength(6);
  expect(screen.queryByText('Dish 5')).toBeNull();

  await fireEvent.press(screen.getByText('More'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/customer/new-order', params: { storeId: '2' } });

  await fireEvent.press(screen.getByText('Dish 9'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/customer/menu/[id]', params: { id: '9', storeId: '2' } });
});

it('puts the store name above the dish name, on one line with Best seller', async () => {
  await renderItem();
  const line = within(screen.getByTestId('store-line'));
  expect(line.getByText('Burger Barn')).toBeTruthy();
  expect(line.getByText('Best seller')).toBeTruthy();

  // Reading order: store line, then the dish name heading.
  const json = JSON.stringify(screen.toJSON());
  expect(json.indexOf('Burger Barn')).toBeLessThan(json.indexOf('"Dish 1"'));
});

it('footer splits 20/80 between Go Back to the store and Add to cart', async () => {
  await renderItem();
  expect(screen.queryByText('Go Back')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Go back to store'));
  expect(router.dismissTo).toHaveBeenCalledWith({ pathname: '/customer/new-order', params: { storeId: '2' } });

  const flexOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).flex;
  expect(flexOf('footer-back')).toBe(1);
  expect(flexOf('footer-add')).toBe(4);
  expect(within(screen.getByTestId('footer-back')).getByTestId('button-icon')).toBeTruthy();
  expect(within(screen.getByTestId('footer-add')).getByText('Add to cart · ₱100.00')).toBeTruthy();
});


it("Add to cart goes to the dish's store page", async () => {
  jest.clearAllMocks();
  await renderItem();
  await fireEvent.press(screen.getByText('Add to cart · ₱100.00'));
  expect(router.dismissTo).toHaveBeenCalledWith({ pathname: '/customer/new-order', params: { storeId: '2' } });
  expect(router.back).not.toHaveBeenCalled();
});
