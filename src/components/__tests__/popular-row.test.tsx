import { fireEvent, render, screen } from '@testing-library/react-native';

import { PopularRow } from '../popular-row';

jest.mock('../icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const make = (id: number) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, sold_out: false, popularity: 0,
  store_id: 1, store_name: 'Tea Haven', store_logo: null,
});

it('renders nothing without items', async () => {
  await render(<PopularRow items={[]} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.queryByText('Popular now')).toBeNull();
  await render(<PopularRow items={undefined} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.queryByText('Popular now')).toBeNull();
});

it('scrolls 6 items then a More tile that opens See all, with no header link', async () => {
  const onSeeAll = jest.fn();
  const onOpen = jest.fn();
  await render(<PopularRow items={[1, 2, 3, 4, 5, 6, 7, 8].map(make)} onSeeAll={onSeeAll} onOpen={onOpen} />);
  expect(screen.getByText('Dish 6')).toBeTruthy();
  expect(screen.queryByText('Dish 7')).toBeNull();
  expect(screen.queryByText('See all')).toBeNull();

  await fireEvent.press(screen.getByText('More'));
  expect(onSeeAll).toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Dish 2'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
});

it('still ends with More when there are fewer than 6', async () => {
  await render(<PopularRow items={[1, 2].map(make)} onSeeAll={() => {}} onOpen={() => {}} />);
  expect(screen.getByText('Dish 2')).toBeTruthy();
  expect(screen.getByText('More')).toBeTruthy();
});
