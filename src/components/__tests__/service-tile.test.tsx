import { fireEvent, render, screen } from '@testing-library/react-native';

import { ServiceTile } from '../service-tile';

jest.mock('../icon', () => ({ Icon: () => null }));

it('shows title and body and handles presses', async () => {
  const onPress = jest.fn();
  await render(<ServiceTile icon={{ ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' }} title="Pickup" body="We bring it." onPress={onPress} />);
  expect(screen.getByText('We bring it.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Pickup'));
  expect(onPress).toHaveBeenCalled();
});
