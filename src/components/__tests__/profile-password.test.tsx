import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProfileScreen } from '@/components/profile-screen';
import { api, ApiError } from '@/lib/api';

jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    state: { status: 'signedIn', user: { id: 1, name: 'Ana', email: 'ana@test.com', phone: '09170000001', role: 'owner' } },
    signOut: jest.fn(),
    updateUser: jest.fn(),
  }),
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ApiError: actual.ApiError, api: jest.fn() };
});
jest.mock('@/components/owner-stores', () => ({ OwnerStores: () => null }));
jest.mock('@/hooks/queries', () => ({ useDriverVerification: () => ({ data: undefined }) }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const renderProfile = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProfileScreen />
    </QueryClientProvider>,
  );

const openForm = async () => {
  await renderProfile();
  await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
  const [password, confirm] = screen.getAllByDisplayValue('');
  return { password, confirm, save: () => screen.getByRole('button', { name: 'Save' }) };
};

beforeEach(() => jest.mocked(api).mockReset());

it('saves only once the new password is 8+ characters and typed the same twice', async () => {
  jest.mocked(api).mockResolvedValue({ ok: true });
  const { password, confirm, save } = await openForm();

  await fireEvent.changeText(password, 'short');
  await fireEvent.changeText(confirm, 'short');
  expect(save()).toBeDisabled();

  await fireEvent.changeText(password, 'brand-new-pass');
  await fireEvent.changeText(confirm, 'brand-new-pas');
  expect(screen.getByText('Passwords do not match')).toBeTruthy();
  expect(save()).toBeDisabled();

  await fireEvent.changeText(confirm, 'brand-new-pass');
  expect(screen.queryByText('Passwords do not match')).toBeNull();
  await fireEvent.press(save());
  expect(api).toHaveBeenCalledWith('/me/password', { body: { password: 'brand-new-pass' } });
  expect(await screen.findByText('Password changed')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy();
});

it('shows why saving failed and keeps the form', async () => {
  jest.mocked(api).mockRejectedValue(new ApiError(0, 'Cannot reach the server. Check your connection.'));
  const { password, confirm, save } = await openForm();
  await fireEvent.changeText(password, 'brand-new-pass');
  await fireEvent.changeText(confirm, 'brand-new-pass');
  await fireEvent.press(save());
  await waitFor(() => expect(screen.getByText('Cannot reach the server. Check your connection.')).toBeTruthy());
  expect(save()).toBeTruthy();
});
