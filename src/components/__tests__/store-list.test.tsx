import { fireEvent, render, screen } from '@testing-library/react-native';

import StoreList from '@/app/customer/stores';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({ type: 'laundry', mode: 'pickup' }) }));
jest.mock('@/hooks/queries', () => ({
  useStores: () => ({
    data: [
      { id: 4, name: 'Suds', address: '1 Main St', store_logo: 'https://img.test/suds.jpg' },
      { id: 5, name: 'Bubbles', address: '2 Main St', store_logo: null },
    ],
    isPending: false,
    isSuccess: true,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it("shows each store's photo, or the service icon when it has none", async () => {
  await render(<StoreList />);
  expect([screen.getByTestId('store-photo-4').props.source].flat()).toEqual([{ uri: 'https://img.test/suds.jpg' }]);
  expect(screen.getByTestId('store-photo-placeholder-5')).toBeTruthy();
});

it('filters the list by name or address as the customer types', async () => {
  await render(<StoreList />);
  const search = screen.getByPlaceholderText('Search stores');
  await fireEvent.changeText(search, 'bub');
  expect(screen.queryByText('Suds')).toBeNull();
  expect(screen.getByText('Bubbles')).toBeTruthy();
  await fireEvent.changeText(search, '1 main');
  expect(screen.getByText('Suds')).toBeTruthy();
  expect(screen.queryByText('Bubbles')).toBeNull();
  await fireEvent.changeText(search, 'zzz');
  expect(screen.getByText('No stores match “zzz”.')).toBeTruthy();
});
