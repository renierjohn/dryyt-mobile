import { render, screen } from '@testing-library/react-native';

import { Avatar } from '../avatar';

it('shows the uppercased first letter', async () => {
  await render(<Avatar name="  maria" />);
  expect(screen.getByText('M')).toBeTruthy();
});

it('falls back to ? for a blank name', async () => {
  await render(<Avatar name="   " />);
  expect(screen.getByText('?')).toBeTruthy();
});
