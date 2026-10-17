import { render, screen } from '@testing-library/react-native';

import { HeaderBand } from '../header-band';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../app-logo', () => ({ AppLogo: () => null }));

it('shows title and subtitle', async () => {
  await render(<HeaderBand title="Hi, Ana" subtitle="What do you need today?" />);
  expect(screen.getByText('Hi, Ana')).toBeTruthy();
  expect(screen.getByText('What do you need today?')).toBeTruthy();
});
