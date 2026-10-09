import { dateTime, localDay, orderTitle, peso, route } from '../format';
import type { Order } from '../types';

const order = (overrides: Partial<Order>) =>
  ({ type: 'pickup', store_type: 'food', store_address: 'Shop St', customer_address: 'Home Ave', ...overrides }) as Order;

describe('peso', () => {
  it('formats centavos with two decimals', () => {
    expect(peso(5000)).toBe('₱50.00');
    expect(peso(12345)).toBe('₱123.45');
    expect(peso(0)).toBe('₱0.00');
  });
});

describe('orderTitle', () => {
  it('names pickups by store type', () => {
    expect(orderTitle({ store_type: 'food' })).toBe('Food/Beverages pickup');
    expect(orderTitle({ store_type: 'laundry' })).toBe('Laundry pickup');
  });
});

describe('route', () => {
  it('goes store to customer for pickups', () => {
    expect(route(order({}))).toEqual({ from: 'Shop St', to: 'Home Ave' });
  });
});

describe('dateTime', () => {
  it('reads D1 UTC text and shows it in local time', () => {
    const utc = '2026-10-13 05:45:53';
    expect(dateTime(utc)).toBe(
      new Date(Date.UTC(2026, 9, 13, 5, 45, 53)).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
    expect(dateTime(utc)).toMatch(/^Oct 1[34], 2026, \d{1,2}:\d{2}\s?[AP]M$/);
  });

  it('passes through text it cannot read', () => {
    expect(dateTime('soon')).toBe('soon');
  });
});

describe('localDay', () => {
  it('groups UTC text by the local calendar day', () => {
    expect(localDay('2026-10-13 05:45:53')).toBe(new Date('2026-10-13T05:45:53Z').toDateString());
    expect(localDay('2026-10-13 05:45:53')).not.toBe(localDay('2026-10-14 05:45:53'));
    expect(localDay('garbage')).toBe('garbage');
  });
});
