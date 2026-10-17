import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MenuItemScreen from '@/app/customer/menu/[id]';
import { CartProvider } from '@/hooks/use-cart';

const mockDish = (id: number) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, popularity: 0,
});
// Menu as the worker returns it: already in the owner's sort_order (not id order).
const mockMenu = [3, 1, 9, 4, 8, 2, 7, 5, 6].map(mockDish);

jest.mock('@/hooks/queries', () => ({
  useStore: () => ({ data: { id: 2, name: 'Burger Barn', menu: mockMenu }, isPending: false, error: null }),
}));
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), back: jest.fn() },
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
