import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SignIn from '@/app/sign-in';
import { signInWithFacebook, signInWithGoogle } from '@/lib/social-auth';

const mockSignIn = jest.fn();
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signIn: mockSignIn }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const renderSignIn = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SignIn />
    </QueryClientProvider>,
  );

beforeEach(() => jest.clearAllMocks());

it('puts Continue with Google below the Sign in button, with the brand logos', async () => {
  await renderSignIn();
  expect(screen.getByTestId('google-logo')).toBeTruthy();
  expect(screen.getByTestId('facebook-logo')).toBeTruthy();
  const json = JSON.stringify(screen.toJSON());
  expect(json.indexOf('Continue with Google')).toBeGreaterThan(json.indexOf('"Sign in"'));
});

it('signs in with the session Google returns', async () => {
  const session = { token: 't', user: { id: 1, email: 'a@b.c', name: 'Ana', phone: '', role: 'customer' } };
  jest.mocked(signInWithGoogle).mockResolvedValueOnce(session as never);
  await renderSignIn();
  await fireEvent.press(screen.getByText('Continue with Google'));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(session));
});

it('does nothing when the Google account picker is closed', async () => {
  jest.mocked(signInWithGoogle).mockResolvedValueOnce(null);
  await renderSignIn();
  await fireEvent.press(screen.getByText('Continue with Google'));
  await waitFor(() => expect(signInWithGoogle).toHaveBeenCalled());
  expect(mockSignIn).not.toHaveBeenCalled();
});

it('puts Continue with Facebook below Google, and signs in with its session', async () => {
  const session = { token: 't', user: { id: 2, email: 'f@b.c', name: 'Fe', phone: '', role: 'customer' } };
  jest.mocked(signInWithFacebook).mockResolvedValueOnce(session as never);
  await renderSignIn();
  const json = JSON.stringify(screen.toJSON());
  expect(json.indexOf('Continue with Facebook')).toBeGreaterThan(json.indexOf('Continue with Google'));
  await fireEvent.press(screen.getByText('Continue with Facebook'));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(session));
});
