import { render, screen } from '@testing-library/react-native';

import { OrderSummary } from '../order-summary';

jest.mock('../icon', () => ({ Icon: () => null }));

const order = {
  id: 7, type: 'pickup' as const, customer_id: 1, driver_id: null, store_id: 1, status: 'pending' as const,
  customer_address: '1 Customer St', notes: '', items_total: 36500, delivery_fee: 5000, created_at: '', updated_at: '',
  store_name: 'Tea Haven', store_address: '12 Mabini St', store_type: 'food' as const, customer_name: 'Ana',
  customer_phone: null, driver_name: null, driver_phone: null,
  items: [
    { id: 1, name: 'Wintermelon Milk Tea', price: 12000, qty: 2, image_url: 'https://img.test/tea.jpg' },
    { id: 2, name: 'Taro Milk Tea', price: 12500, qty: 1, image_url: null },
  ],
};

it('shows each item with its photo, or a placeholder', async () => {
  await render(<OrderSummary order={order} />);
  expect([screen.getByTestId('order-item-photo-1').props.source].flat()).toEqual([{ uri: 'https://img.test/tea.jpg' }]);
  expect(screen.getByTestId('order-item-photo-placeholder-2')).toBeTruthy();
  expect(screen.getByText('2 × Wintermelon Milk Tea')).toBeTruthy();
  expect(screen.getByText('₱240.00')).toBeTruthy();
});

it('puts the total below a line, after the items', async () => {
  await render(<OrderSummary order={order} />);
  expect(screen.getByTestId('order-total-separator')).toBeTruthy();
  expect(screen.getByText('₱415.00')).toBeTruthy();
  const json = JSON.stringify(screen.toJSON());
  expect(json.indexOf('Taro Milk Tea')).toBeLessThan(json.indexOf('order-total-separator'));
  expect(json.indexOf('order-total-separator')).toBeLessThan(json.indexOf('₱415.00'));
});
