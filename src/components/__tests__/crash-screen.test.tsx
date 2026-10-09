import { fireEvent, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';

import { CrashScreen } from '../crash-screen';

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View };
});

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

it('shows the error, hides the splash, and retries', async () => {
  const retry = jest.fn();
  await render(<CrashScreen error={new Error('boom')} retry={retry} />);

  expect(await screen.findByText('boom')).toBeTruthy();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();

  await fireEvent.press(screen.getByText('Try again'));
  expect(retry).toHaveBeenCalled();
});
