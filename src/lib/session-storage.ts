import * as SecureStore from 'expo-secure-store';

import type { User } from './types';

const KEY = 'session';

export type Session = { token: string; user: User };

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export const saveSession = (session: Session) => SecureStore.setItemAsync(KEY, JSON.stringify(session));

export const clearSession = () => SecureStore.deleteItemAsync(KEY);

const ONLINE_KEY = 'driver_online';

/** The driver's last known "Online for drop offs" switch, so it shows right away on start. Null for another user. */
export async function loadOnline(userId: number): Promise<boolean | null> {
  const raw = await SecureStore.getItemAsync(ONLINE_KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw) as { userId: number; online: boolean };
  return saved.userId === userId ? saved.online : null;
}

export const saveOnline = (userId: number, online: boolean) => SecureStore.setItemAsync(ONLINE_KEY, JSON.stringify({ userId, online }));

export const clearOnline = () => SecureStore.deleteItemAsync(ONLINE_KEY);
