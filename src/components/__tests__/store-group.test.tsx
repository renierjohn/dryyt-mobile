import { fireEvent, render, screen } from '@testing-library/react-native';

import { groupByStore, StoreGroup } from '../store-group';

jest.mock('../icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const make = (id: number, store_id: number, store_name: string) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: '', best_seller: false, popularity: 0,
  store_id, store_name, store_logo: null,
});

it('groups by store in order of each store’s first (most popular) item', () => {
  const groups = groupByStore([make(6, 2, 'Burger Barn'), make(2, 1, 'Tea Haven'), make(5, 2, 'Burger Barn'), make(1, 1, 'Tea Haven')]);
  expect(groups.map((g) => [g.storeId, g.items.map((i) => i.id)])).toEqual([
    [2, [6, 5]],
    [1, [2, 1]],
  ]);
  expect(groups[0]).toMatchObject({ storeName: 'Burger Barn', storeLogo: null });
});

it('opens the store from its header and items from their cards', async () => {
  const onOpenStore = jest.fn();
  const onOpenItem = jest.fn();
  const [group] = groupByStore([make(6, 2, 'Burger Barn'), make(5, 2, 'Burger Barn'), make(7, 2, 'Burger Barn')]);
  await render(<StoreGroup group={group} onOpenStore={onOpenStore} onOpenItem={onOpenItem} />);

  await fireEvent.press(screen.getByText('Burger Barn'));
  expect(onOpenStore).toHaveBeenCalledWith(2);
  await fireEvent.press(screen.getByText('Dish 7'));
  expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
});

it('shows at most 6 items and a More button that opens the store', async () => {
  const onOpenStore = jest.fn();
  const [group] = groupByStore([1, 2, 3, 4, 5, 6, 7, 8].map((id) => make(id, 2, 'Burger Barn')));
  await render(<StoreGroup group={group} onOpenStore={onOpenStore} onOpenItem={() => {}} />);

  expect(screen.getByText('Dish 6')).toBeTruthy();
  expect(screen.queryByText('Dish 7')).toBeNull();
  await fireEvent.press(screen.getByText('More'));
  expect(onOpenStore).toHaveBeenCalledWith(2);
});

it('has no More button when everything fits', async () => {
  const [group] = groupByStore([1, 2, 3, 4, 5, 6].map((id) => make(id, 2, 'Burger Barn')));
  await render(<StoreGroup group={group} onOpenStore={() => {}} onOpenItem={() => {}} />);
  expect(screen.getByText('Dish 6')).toBeTruthy();
  expect(screen.queryByText('More')).toBeNull();
});

