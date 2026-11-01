import { render } from '@testing-library/react-native';

import { MenuEditor } from '@/components/menu-editor';

const item = (id: number, sold_out = false) => ({
  id, name: `Dish ${id}`, price: 10000, discount_percent: 0, image_url: null, category: 'Meals', best_seller: false, sold_out, popularity: 0,
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
// Counts each row's renders (one photo per row).
const mockPhotoRender = jest.fn();
jest.mock('@/components/dish-photo', () => ({ DishPhoto: ({ testID }: { testID: string }) => (mockPhotoRender(testID), null) }));
// Rows as a plain list, with one handle wrapper for good, like each SortableList row keeps its own.
const mockHandle = (node: unknown) => node;
jest.mock('@/components/sortable-list', () => ({
  SortableList: ({ items, renderItem }: { items: { id: number }[]; renderItem: (item: unknown, handle: (n: unknown) => unknown) => unknown }) =>
    items.map((i) => {
      const { Fragment, createElement } = jest.requireActual('react');
      return createElement(Fragment, { key: i.id }, renderItem(i, mockHandle));
    }),
}));
let mockMenu = [item(1), item(2), item(3)];
// Stable like useMutation's own `mutate`.
const mockRemove = { mutate: jest.fn(), isPending: false, error: null };
jest.mock('@/hooks/queries', () => ({
  useStore: () => ({ data: { menu: mockMenu }, isPending: false, isSuccess: true, error: null }),
  useReorderMenu: () => ({ mutate: jest.fn(), error: null }),
  useDeleteMenuItem: () => mockRemove,
  useSaveMenuItem: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));

it('re-renders only the row whose item changed (e.g. marked sold out)', async () => {
  const view = await render(<MenuEditor storeId={1} />);
  mockPhotoRender.mockClear();

  // The saved item comes back as a new object; React Query keeps the others as they were.
  mockMenu = [mockMenu[0], { ...mockMenu[1], sold_out: true }, mockMenu[2]];
  await view.rerender(<MenuEditor storeId={1} />);
  expect(mockPhotoRender.mock.calls).toEqual([['menu-photo-2']]);
});
