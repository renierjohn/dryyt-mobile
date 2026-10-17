import { render, screen } from '@testing-library/react-native';

import CustomerHome from '@/app/customer/(tabs)/index';
import { BottomTabInset } from '@/constants/theme';

jest.mock('@/components/cart-button', () => {
  const { Text } = jest.requireActual('react-native');
  return { CartButton: (props: { bottom?: number }) => <Text>{`cart-bottom:${props.bottom ?? 0}`}</Text> };
});
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ state: { status: 'signedIn', user: { name: 'Ana' } } }) }));
jest.mock('@/hooks/queries', () => ({
  useHistory: () => ({ data: undefined, refresh: jest.fn() }),
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
