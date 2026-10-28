import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProfileScreen } from '@/components/profile-screen';
import { api, ApiError } from '@/lib/api';

const mockUpdateUser = jest.fn(async () => {});
const mockUser = { id: 1, name: 'Ana', email: 'ana@test.com', phone: '09170000001', role: 'customer' };
jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ state: { status: 'signedIn', user: mockUser }, signOut: jest.fn(), updateUser: mockUpdateUser }),
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ApiError: actual.ApiError, api: jest.fn() };
});
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

beforeEach(() => {
  jest.mocked(api).mockReset();
  mockUpdateUser.mockClear();
});

it('edits the email and phone, saves them to the account and the session', async () => {
  const saved = { ...mockUser, email: 'new@test.com', phone: '09998887777' };
  jest.mocked(api).mockResolvedValue({ user: saved });
  await renderProfile();

  await fireEvent.press(screen.getByRole('button', { name: 'Edit email and phone' }));
  await fireEvent.changeText(screen.getByDisplayValue('ana@test.com'), 'new@test.com');
  await fireEvent.changeText(screen.getByDisplayValue('09170000001'), '09998887777');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(api).toHaveBeenCalledWith('/me', { method: 'PATCH', body: { email: 'new@test.com', phone: '09998887777' } });
  await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith(saved));
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
});

it('shows why a save failed and keeps the form open', async () => {
  jest.mocked(api).mockRejectedValue(new ApiError(409, 'Email is already registered'));
  await renderProfile();

  await fireEvent.press(screen.getByRole('button', { name: 'Edit email and phone' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Email is already registered')).toBeTruthy();
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
});

it('cancel leaves the details as they were', async () => {
  await renderProfile();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit email and phone' }));
  await fireEvent.changeText(screen.getByDisplayValue('ana@test.com'), 'typo@');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByText('ana@test.com')).toBeTruthy();
  expect(api).not.toHaveBeenCalled();
});
