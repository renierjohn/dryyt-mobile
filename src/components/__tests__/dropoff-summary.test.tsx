import { fireEvent, render, screen } from '@testing-library/react-native';

import { DropoffSummary } from '@/components/dropoff-summary';
import type { Dropoff } from '@/lib/types';

jest.mock('@/components/photo-viewer');
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
