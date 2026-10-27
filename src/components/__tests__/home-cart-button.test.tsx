import { render, screen } from '@testing-library/react-native';

import CustomerHome from '@/app/customer/(tabs)/index';
import { BottomTabInset } from '@/constants/theme';

jest.mock('@/components/cart-button', () => {
  const { Text } = jest.requireActual('react-native');
  return { CartButton: (props: { bottom?: number }) => <Text>{`cart-bottom:${props.bottom ?? 0}`}</Text> };
});
let mockSignedIn = true;
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ state: mockSignedIn ? { status: 'signedIn', user: { name: 'Ana' } } : { status: 'signedOut' } }) }));
const mockUseHistory = jest.fn();
const recentOrder = { kind: 'dropoff', id: 7 };
jest.mock('@/components/history-list', () => {
  const { Text } = jest.requireActual('react-native');
  return { HistoryCard: () => <Text>recent order</Text>, historyKey: (i: { id: number }) => String(i.id) };
});
jest.mock('@/hooks/queries', () => ({
  useHistory: (enabled: boolean) => {
    mockUseHistory(enabled);
    return { data: { pages: [{ items: [recentOrder] }] }, refresh: jest.fn() };
  },
  usePopularMenu: () => ({ data: { items: [], categories: [] }, refetch: jest.fn() }),
}));
jest.mock('@/components/header-band', () => ({ HeaderBand: () => null }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it('lifts the cart button above the tab bar', async () => {
  await render(<CustomerHome />);
  expect(screen.getByText(`cart-bottom:${BottomTabInset}`)).toBeTruthy();
});

it('shows recent orders when signed in', async () => {
  await render(<CustomerHome />);
  expect(mockUseHistory).toHaveBeenLastCalledWith(true);
  expect(screen.getByText('Recent orders')).toBeTruthy();
});

it('shows a guest the home without recent orders, and loads no history', async () => {
  mockSignedIn = false;
  try {
    await render(<CustomerHome />);
    expect(mockUseHistory).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Recent orders')).toBeNull();
    expect(screen.queryByText('recent order')).toBeNull();
  } finally {
    mockSignedIn = true;
  }
});
