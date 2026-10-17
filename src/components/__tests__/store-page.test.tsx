import { fireEvent, render, screen } from '@testing-library/react-native';

import StorePage from '@/app/customer/new-order';
import { CartProvider } from '@/hooks/use-cart';

const mockItem = (id: number, category: string, image_url: string | null = null) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url, category, best_seller: false, popularity: 0,
});
const mockStore = {
  id: 2, name: 'Burger Barn', type: 'food', address: '45 Rizal Ave, Makati', lat: null, lng: null,
  store_logo: 'https://img.test/logo.png', store_payment_gateway: [],
  // Owner's sort_order: categories appear in this order.
  menu: [mockItem(5, 'Burgers', 'https://img.test/5.jpg'), mockItem(7, 'Sides'), mockItem(6, 'Burgers'), mockItem(8, '')],
};

jest.mock('@/hooks/queries', () => ({
  useStore: () => ({ data: mockStore, isPending: false, isError: false, error: null }),
  useCreateOrder: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));
jest.mock('expo-router', () => {
  const { createElement } = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn() },
    useLocalSearchParams: () => ({ storeId: '2' }),
    // Expose the header colour the screen asks for.
    Stack: { Screen: ({ options }: { options: { headerStyle?: { backgroundColor?: string } } }) => createElement(Text, null, `nav-bg:${options.headerStyle?.backgroundColor}`) },
    useFocusEffect: () => {},
  };
});
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/components/app-logo', () => ({ AppLogo: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const renderStore = () =>
  render(
    <CartProvider>
      <StorePage />
    </CartProvider>,
  );

it('heads the page with the store in the blue band over its logo', async () => {
  await renderStore();
  expect(screen.getByText('Burger Barn')).toBeTruthy();
  expect(screen.getByText('45 Rizal Ave, Makati')).toBeTruthy();
  expect([screen.getByTestId('band-background').props.source].flat()).toEqual([{ uri: 'https://img.test/logo.png' }]);
  expect(screen.getByText('nav-bg:#3B82F6')).toBeTruthy();
});

it('filters the menu by category tabs in menu order, All restores it', async () => {
  await renderStore();
  const tabs = ['All', 'Burgers', 'Sides'].map((t) => screen.getByText(t));
  expect(tabs).toHaveLength(3);
  expect(screen.getByText('Dish 8')).toBeTruthy();

  await fireEvent.press(screen.getByText('Sides'));
  expect(screen.getByText('Dish 7')).toBeTruthy();
  expect(screen.queryByText('Dish 5')).toBeNull();
  expect(screen.queryByText('Dish 8')).toBeNull();

  await fireEvent.press(screen.getByText('All'));
  expect(screen.getByText('Dish 5')).toBeTruthy();
  expect(screen.getByText('Dish 8')).toBeTruthy();
});

it('shows each dish photo, or a placeholder without one', async () => {
  await renderStore();
  expect([screen.getByTestId('dish-photo-5').props.source].flat()).toEqual([{ uri: 'https://img.test/5.jpg' }]);
  expect(screen.getByTestId('dish-photo-placeholder-7')).toBeTruthy();
});
