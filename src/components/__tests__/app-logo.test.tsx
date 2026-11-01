import { render } from '@testing-library/react-native';
import { createElement } from 'react';

import { AppLogo } from '../app-logo';

const mockImageRender = jest.fn();
jest.mock('expo-image', () => ({ Image: () => (mockImageRender(), null) }));

it('skips re-rendering for a new element with the same size, like the header makes', async () => {
  // headerTitle: () => <AppLogo size={32} /> builds a new element on each header render.
  const view = await render(createElement(AppLogo, { size: 32 }));
  await view.rerender(createElement(AppLogo, { size: 32 }));
  expect(mockImageRender).toHaveBeenCalledTimes(1);

  await view.rerender(createElement(AppLogo, { size: 48 }));
  expect(mockImageRender).toHaveBeenCalledTimes(2);
});
