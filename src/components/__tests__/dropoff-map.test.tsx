import { fireEvent, render, screen } from '@testing-library/react-native';

import { DropoffMap } from '@/components/dropoff-map';
import { Screen } from '@/components/screen';

jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/components/app-logo', () => ({ AppLogo: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

it('keeps the screen still while a finger is on the map, and scrolls again once it lifts', async () => {
  await render(
    <Screen>
      <DropoffMap center={{ lat: 14.55, lng: 121.02 }} pins={[]} />
    </Screen>,
  );
  const scroll = () => screen.getByTestId('screen-scroll').props.scrollEnabled;
  expect(scroll()).toBe(true);

  await fireEvent(screen.getByTestId('map-touch-area'), 'touchStart');
  expect(scroll()).toBe(false);
  await fireEvent(screen.getByTestId('map-touch-area'), 'touchEnd');
  expect(scroll()).toBe(true);

  // A cancelled touch (e.g. the system takes it) unlocks too.
  await fireEvent(screen.getByTestId('map-touch-area'), 'touchStart');
  await fireEvent(screen.getByTestId('map-touch-area'), 'touchCancel');
  expect(scroll()).toBe(true);
});
