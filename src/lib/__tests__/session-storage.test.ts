import * as SecureStore from 'expo-secure-store';

import { clearOnline, clearSession, loadOnline, loadSession, saveOnline, saveSession, type Session } from '../session-storage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
  };
});

const session = { token: 't0k', user: { id: 1, name: 'Ana' } } as Session;

it('round-trips a session through secure store', async () => {
  expect(await loadSession()).toBeNull();
  await saveSession(session);
  expect(await loadSession()).toEqual(session);
  await clearSession();
  expect(await loadSession()).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('session');
});

it("keeps the driver's online switch per user until cleared", async () => {
  expect(await loadOnline(1)).toBeNull();
  await saveOnline(1, true);
  expect(await loadOnline(1)).toBe(true);
  expect(await loadOnline(2)).toBeNull();
  await saveOnline(1, false);
  expect(await loadOnline(1)).toBe(false);
  await clearOnline();
  expect(await loadOnline(1)).toBeNull();
});
