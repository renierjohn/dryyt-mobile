import { render, screen } from '@testing-library/react-native';

import { MenuEditor } from '@/components/menu-editor';

const item = (id: number, image_url: string | null) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url, category: 'Meals', best_seller: false, sold_out: false, popularity: 0,
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
// Rows as a plain list: the drag-to-reorder layer isn't under test.
jest.mock('@/components/sortable-list', () => ({
  SortableList: ({ items, renderItem }: { items: { id: number }[]; renderItem: (item: unknown, handle: (n: unknown) => unknown) => unknown }) =>
    items.map((i) => renderItem(i, (node) => node)),
}));
jest.mock('@/hooks/queries', () => ({
  useStore: () => ({ data: { menu: [item(1, 'https://img.test/1.jpg'), item(2, null)] }, isPending: false, isSuccess: true, error: null }),
  useReorderMenu: () => ({ mutate: jest.fn(), error: null }),
  useDeleteMenuItem: () => ({ mutate: jest.fn(), isPending: false, error: null }),
  useSaveMenuItem: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));

it("shows each menu item's photo before its name, or a placeholder", async () => {
  await render(<MenuEditor storeId={1} />);
  expect([screen.getByTestId('menu-photo-1').props.source].flat()).toEqual([{ uri: 'https://img.test/1.jpg' }]);
  expect(screen.getByTestId('menu-photo-2-placeholder')).toBeTruthy();
});
