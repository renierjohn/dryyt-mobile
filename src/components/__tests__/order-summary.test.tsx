import { render, screen } from '@testing-library/react-native';

import { OrderSummary } from '../order-summary';

jest.mock('../icon', () => ({ Icon: () => null }));

const order = {
  id: 7, type: 'pickup' as const, customer_id: 1, driver_id: null, store_id: 1, status: 'pending' as const,
  customer_address: '1 Customer St', notes: '', items_total: 36500, delivery_fee: 5000, created_at: '', updated_at: '', payment_ref: '', payment_photo_key: null, service_fee: 0,
  customer_lat: null, customer_lng: null, store_lat: null, store_lng: null, driver_lat: null, driver_lng: null, driver_loc_at: null,
  driver_has_face: false, driver_has_id: false, driver_photo_version: '-', driver_notes: '', driver_verified: false,
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
  expect(screen.getByTestId('order-item-photo-2-placeholder')).toBeTruthy();
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

it("shows drivers the delivery fee split into their share and the service fee, above the total", async () => {
  await render(<OrderSummary order={{ ...order, delivery_fee: 7920, service_fee: 720 }} showFees />);
  const json = JSON.stringify(screen.toJSON());
  expect(screen.getByText('₱72.00')).toBeTruthy();
  expect(screen.getByText('₱7.20')).toBeTruthy();
  expect(json.indexOf('Delivery fee')).toBeLessThan(json.indexOf('Service fee'));
  expect(json.indexOf('Service fee')).toBeLessThan(json.indexOf('Total Amount'));
  expect(screen.getByText('₱444.20')).toBeTruthy();
});

it('shows customers one delivery fee that includes the service fee, above the total', async () => {
  await render(<OrderSummary order={{ ...order, delivery_fee: 7920, service_fee: 720 }} />);
  expect(screen.queryByText('Service fee')).toBeNull();
  expect(screen.getByText('₱79.20')).toBeTruthy();
  const json = JSON.stringify(screen.toJSON());
  expect(json.indexOf('Delivery fee')).toBeLessThan(json.indexOf('Total Amount'));
});

it("leaves out To: for a pinned location's coordinates, but keeps a typed address", async () => {
  await render(<OrderSummary order={{ ...order, customer_address: 'Pinned location 14.56000, 121.03000' }} />);
  expect(screen.queryByText(/^To:/)).toBeNull();
  await render(<OrderSummary order={order} />);
  expect(screen.getByText('To: 1 Customer St')).toBeTruthy();
});

it('shows the store address after a pin icon instead of "From:"', async () => {
  await render(<OrderSummary order={order} />);
  expect(screen.getByText('12 Mabini St')).toBeTruthy();
  expect(screen.queryByText(/From:/)).toBeNull();
});
