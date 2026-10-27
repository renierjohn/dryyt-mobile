import { renderHook } from '@testing-library/react-native';

import { useSignedIn } from '@/hooks/use-auth';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/query-client', () => ({ queryClient: { clear: jest.fn() } }));
let mockStatus = 'signedIn';
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, use: () => ({ state: { status: mockStatus } }) };
});

it('runs the action when signed in', async () => {
  mockStatus = 'signedIn';
  const action = jest.fn();
  const { result } = await renderHook(() => useSignedIn());
  result.current(action)();
  expect(action).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

it('sends a guest to sign in instead', async () => {
  mockStatus = 'signedOut';
  const action = jest.fn();
  const { result } = await renderHook(() => useSignedIn());
  result.current(action)();
  expect(action).not.toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/sign-in');
});
