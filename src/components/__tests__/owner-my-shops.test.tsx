import { render, screen } from '@testing-library/react-native';

import { OwnerStores } from '@/components/owner-stores';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('@/hooks/queries', () => ({
  useOwnerStores: () => ({
    data: {
      stores: [
        { id: 4, name: 'Suds', type: 'laundry', address: '1 Main St', store_logo: 'https://img.test/suds.jpg', store_payment_gateway: [] },
        { id: 5, name: 'Bubbles', type: 'laundry', address: '2 Main St', store_logo: null, store_payment_gateway: [] },
      ],
      maxstore: 3,
    },
    isPending: false,
    isSuccess: true,
    error: null,
  }),
  useDeleteStore: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));

it("shows each shop's photo before its name, or a placeholder", async () => {
  await render(<OwnerStores />);
  expect([screen.getByTestId('my-shop-photo-4').props.source].flat()).toEqual([{ uri: 'https://img.test/suds.jpg' }]);
  expect(screen.getByTestId('my-shop-photo-5-placeholder')).toBeTruthy();
});
