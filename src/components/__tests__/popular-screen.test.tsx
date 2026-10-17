import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import Popular from '@/app/customer/popular';

const mockUsePopularMenu = jest.fn();
jest.mock('@/hooks/queries', () => ({ usePopularMenu: (args: unknown) => mockUsePopularMenu(args) }));
jest.mock('@/components/cart-button', () => ({ CartButton: () => null }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const item = (id: number, store_id: number, store_name: string) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, popularity: 0,
  store_id, store_name, store_logo: null,
});
const result = (items: ReturnType<typeof item>[]) => ({
  data: { items, categories: ['Burgers', 'Milk Tea'] }, isPending: false, isSuccess: true, isPlaceholderData: false, error: null, refetch: jest.fn(),
});

beforeEach(() => {
  jest.useFakeTimers();
  mockUsePopularMenu.mockReset();
});
afterEach(() => jest.useRealTimers());

it('groups results by store and opens a store page from its name', async () => {
  mockUsePopularMenu.mockReturnValue(result([item(6, 2, 'Burger Barn'), item(2, 1, 'Tea Haven')]));
  await render(<Popular />);
  expect(mockUsePopularMenu).toHaveBeenLastCalledWith({ limit: 50, q: '', category: null });

  await fireEvent.press(screen.getByText('Tea Haven'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/customer/new-order', params: { storeId: '1' } });
});

it('searches after typing stops and filters by category', async () => {
  mockUsePopularMenu.mockReturnValue(result([item(6, 2, 'Burger Barn')]));
  await render(<Popular />);

  await fireEvent.changeText(screen.getByPlaceholderText('Search dishes'), 'burg');
  expect(mockUsePopularMenu).toHaveBeenLastCalledWith({ limit: 50, q: '', category: null });
  await act(() => jest.advanceTimersByTime(300));
  expect(mockUsePopularMenu).toHaveBeenLastCalledWith({ limit: 50, q: 'burg', category: null });

  await fireEvent.press(screen.getByText('Burgers'));
  expect(mockUsePopularMenu).toHaveBeenLastCalledWith({ limit: 50, q: 'burg', category: 'Burgers' });
});

it('shows an empty state that clears the filters', async () => {
  mockUsePopularMenu.mockReturnValue(result([]));
  await render(<Popular />);
  await fireEvent.changeText(screen.getByPlaceholderText('Search dishes'), 'pizza');
  await act(() => jest.advanceTimersByTime(300));

  expect(screen.getByText('No dishes match “pizza”.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Clear filters'));
  expect(mockUsePopularMenu).toHaveBeenLastCalledWith({ limit: 50, q: '', category: null });
  expect(screen.getByPlaceholderText('Search dishes').props.value).toBe('');
});
