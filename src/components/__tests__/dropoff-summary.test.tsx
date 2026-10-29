import { fireEvent, render, screen } from '@testing-library/react-native';

import { DropoffSummary } from '@/components/dropoff-summary';
import type { Dropoff } from '@/lib/types';

jest.mock('@/components/photo-viewer');
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/lib/api', () => ({ apiUrl: (p: string) => `https://api.test${p}`, authHeaders: () => ({ authorization: 'Bearer t' }) }));

const dropoff = {
  id: 7, created_at: '2026-10-17 04:00:00', store_name: 'Shop', customer_address: 'Here', weight_kg: 6.5, total_delivery_fee: 5000,
  laundry_fee: 25000, drop_notes: '', has_proof: true,
} as Dropoff;

it('opens the proof photo full screen when tapped, and closes it', async () => {
  await render(<DropoffSummary dropoff={dropoff} />);
  expect(screen.queryByTestId('photo-viewer')).toBeNull();
  await fireEvent.press(screen.getByLabelText('View proof photo'));
  expect(screen.getByText('https://api.test/dropoffs/7/proof')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('photo-viewer'));
  expect(screen.queryByTestId('photo-viewer')).toBeNull();
});

it("shows the shop's logo before its name, or a placeholder without one", async () => {
  await render(<DropoffSummary dropoff={{ ...dropoff, store_logo: 'https://img.test/logo.png' }} />);
  expect(screen.getByTestId('dropoff-summary-store-logo').props.source).toEqual([{ uri: 'https://img.test/logo.png' }]);
  await render(<DropoffSummary dropoff={{ ...dropoff, store_logo: null }} />);
  expect(screen.getByTestId('dropoff-summary-store-logo-placeholder')).toBeTruthy();
});

it('calls the sum "Total Delivery fee" below the fee split, and just "Delivery fee" for the customer', async () => {
  await render(<DropoffSummary dropoff={{ ...dropoff, delivery_fee: 4000, service_fee: 1000 }} />);
  expect(screen.getByText('Total Delivery fee')).toBeTruthy();
  expect(screen.getAllByText('Delivery fee')).toHaveLength(1);
  expect(screen.getByTestId('total-delivery-fee-separator')).toBeTruthy();
  await render(<DropoffSummary dropoff={dropoff} />);
  expect(screen.queryByText('Total Delivery fee')).toBeNull();
  expect(screen.queryByTestId('total-delivery-fee-separator')).toBeNull();
  expect(screen.getByText('Delivery fee')).toBeTruthy();
});
