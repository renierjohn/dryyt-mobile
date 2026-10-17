import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Screen } from '../screen';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../app-logo', () => {
  const { createElement } = jest.requireActual('react');
  const { Text: RNText } = jest.requireActual('react-native');
  return { AppLogo: () => createElement(RNText, null, 'logo') };
});

it('shows the logo header by default', async () => {
  await render(<Screen><Text>body</Text></Screen>);
  expect(screen.getByText('logo')).toBeTruthy();
});

it('replaces the logo with a custom header and renders a footer', async () => {
  await render(
    <Screen edges={[]} header={<Text>band</Text>} footer={<Text>pay</Text>}>
      <Text>body</Text>
    </Screen>,
  );
  expect(screen.queryByText('logo')).toBeNull();
  expect(screen.getByText('band')).toBeTruthy();
  expect(screen.getByText('pay')).toBeTruthy();
});

it('keeps footer screens above the keyboard', async () => {
  await render(
    <Screen edges={[]} footer={<Text>pay</Text>}>
      <Text>body</Text>
    </Screen>,
  );
  expect(screen.getByTestId('keyboard-avoider')).toBeTruthy();
});
