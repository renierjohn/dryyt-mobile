import { fireEvent, render, screen } from '@testing-library/react-native';

import { CategoryChips } from '../category-chips';

it('selects a category, clears it on a second tap, and All clears too', async () => {
  const onSelect = jest.fn();
  const view = await render(<CategoryChips categories={['Burgers', 'Milk Tea']} selected={null} onSelect={onSelect} />);
  await fireEvent.press(screen.getByText('Milk Tea'));
  expect(onSelect).toHaveBeenLastCalledWith('Milk Tea');

  await view.rerender(<CategoryChips categories={['Burgers', 'Milk Tea']} selected="Milk Tea" onSelect={onSelect} />);
  await fireEvent.press(screen.getByText('Milk Tea'));
  expect(onSelect).toHaveBeenLastCalledWith(null);
  await fireEvent.press(screen.getByText('All'));
  expect(onSelect).toHaveBeenLastCalledWith(null);
});

it('renders nothing without categories', async () => {
  await render(<CategoryChips categories={[]} selected={null} onSelect={() => {}} />);
  expect(screen.queryByText('All')).toBeNull();
});
