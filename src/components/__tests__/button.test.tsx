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

it('shows an icon beside the title when given one', async () => {
  await render(<Button title="Go Back" icon={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} onPress={() => {}} />);
  expect(screen.getByTestId('button-icon')).toBeTruthy();
  expect(screen.getByText('Go Back')).toBeTruthy();
});

it('stacks icon over a small title with tight padding for narrow slots', async () => {
  await render(<Button title="Go Back" stacked icon={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} onPress={() => {}} />);
  expect(StyleSheet.flatten(screen.getByTestId('button-content').props.style).flexDirection).toBe('column');
  expect(StyleSheet.flatten(screen.getByText('Go Back').props.style).fontSize).toBe(12);
});

