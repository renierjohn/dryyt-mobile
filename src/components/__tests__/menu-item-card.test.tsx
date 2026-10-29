import { fireEvent, render, screen } from '@testing-library/react-native';

import { MenuItemCard } from '../menu-item-card';

jest.mock('../icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const item = { id: 6, name: 'Cheeseburger', price: 17000, discount_percent: 20, image_url: null, category: '', best_seller: false, sold_out: false, popularity: 5 };

it('shows the discounted price, the original struck through, and the store', async () => {
  const onPress = jest.fn();
  await render(<MenuItemCard item={item} storeName="Burger Barn" onPress={onPress} />);
  expect(screen.getByText('₱136.00')).toBeTruthy();
  expect(screen.getByText('₱170.00')).toBeTruthy();
  expect(screen.getByText('Burger Barn')).toBeTruthy();
  await fireEvent.press(screen.getByText('Cheeseburger'));
  expect(onPress).toHaveBeenCalled();
});

it('shows one price when not discounted', async () => {
  await render(<MenuItemCard item={{ ...item, discount_percent: 0 }} onPress={() => {}} />);
  expect(screen.getByText('₱170.00')).toBeTruthy();
  expect(screen.queryByText('₱136.00')).toBeNull();
});
