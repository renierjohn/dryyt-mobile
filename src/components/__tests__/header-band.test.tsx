import { render, screen } from '@testing-library/react-native';
import { setStatusBarStyle } from 'expo-status-bar';

import { HeaderBand } from '../header-band';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../app-logo', () => ({ AppLogo: () => null }));
jest.mock('expo-status-bar', () => ({ setStatusBarStyle: jest.fn() }));
// Run the focus effect once on mount and its cleanup on unmount, like a screen gaining then losing focus.
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => () => void) => jest.requireActual('react').useEffect(effect, []) }));

it('shows title and subtitle', async () => {
  await render(<HeaderBand title="Hi, Ana" subtitle="What do you need today?" />);
  expect(screen.getByText('Hi, Ana')).toBeTruthy();
  expect(screen.getByText('What do you need today?')).toBeTruthy();
});

it('uses light status bar icons while focused and restores them after', async () => {
  const view = await render(<HeaderBand title="Hi" />);
  expect(setStatusBarStyle).toHaveBeenLastCalledWith('light');
  await view.unmount();
  expect(setStatusBarStyle).toHaveBeenLastCalledWith('auto');
});
