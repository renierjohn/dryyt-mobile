import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { Button } from '../button';

it('calls onPress for every variant', async () => {
  for (const variant of ['primary', 'secondary', 'outline', 'danger'] as const) {
    const onPress = jest.fn();
    await render(<Button title={variant} variant={variant} onPress={onPress} />);
    await fireEvent.press(screen.getByText(variant));
    expect(onPress).toHaveBeenCalledTimes(1);
  }
});

it('ignores presses while disabled', async () => {
  const onPress = jest.fn();
  await render(<Button title="Go" disabled onPress={onPress} />);
  await fireEvent.press(screen.getByText('Go'));
  expect(onPress).not.toHaveBeenCalled();
});

it('draws secondary as primary-blue text on a soft blue pill', async () => {
  await render(<Button title="More" variant="secondary" onPress={() => {}} />);
  expect(StyleSheet.flatten(screen.getByText('More').props.style).color).toBe(Colors.light.primary);
});
