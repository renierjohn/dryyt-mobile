import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SignUp from '@/app/sign-up';
import { api } from '@/lib/api';

jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signIn: jest.fn() }) }));
jest.mock('@/lib/api', () => ({ api: jest.fn(async () => ({ token: 't', user: {} })) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const renderSignUp = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignUp />
    </QueryClientProvider>,
  );

it('needs the password typed twice the same before creating the account', async () => {
  await renderSignUp();
  const [password, confirm] = screen.getAllByDisplayValue('').slice(3);
  const create = () => screen.getByRole('button', { name: 'Create account' });

  await fireEvent.changeText(password, 'password123');
  expect(create()).toBeDisabled();
  expect(screen.queryByText('Passwords do not match')).toBeNull();

  await fireEvent.changeText(confirm, 'password12');
  expect(screen.getByText('Passwords do not match')).toBeTruthy();
  expect(create()).toBeDisabled();

  await fireEvent.changeText(confirm, 'password123');
  expect(screen.queryByText('Passwords do not match')).toBeNull();
  expect(create()).toBeEnabled();
  await fireEvent.press(create());
  expect(api).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ body: expect.objectContaining({ password: 'password123' }) }));
  expect(JSON.stringify(jest.mocked(api).mock.calls[0])).not.toContain('confirm');
});
