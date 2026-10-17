import { fireEvent, render, screen } from '@testing-library/react-native';

import { PopularRow } from '../popular-row';

jest.mock('../icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const make = (id: number) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, popularity: 0,
  store_id: 1, store_name: 'Tea Haven', store_logo: null,
});

it('renders nothing without items', async () => {
  await render(<PopularRow items={[]} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.queryByText('Popular now')).toBeNull();
  await render(<PopularRow items={undefined} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.queryByText('Popular now')).toBeNull();
});

it('shows at most 4 items and See all', async () => {
  const onSeeAll = jest.fn();
  await render(<PopularRow items={[1, 2, 3, 4, 5].map(make)} onSeeAll={onSeeAll} onOpen={() => {}} />);
  expect(screen.getByText('Dish 4')).toBeTruthy();
  expect(screen.queryByText('Dish 5')).toBeNull();
  await fireEvent.press(screen.getByText('See all'));
  expect(onSeeAll).toHaveBeenCalled();
});
