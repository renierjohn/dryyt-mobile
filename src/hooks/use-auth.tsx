import { router } from 'expo-router';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from '@/lib/api';
import { signOutOfSocial } from '@/lib/social-auth';
import { queryClient } from '@/lib/query-client';
import { clearOnline, clearSession, loadSession, saveSession, type Session } from '@/lib/session-storage';
import type { User } from '@/lib/types';

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User };

type AuthContextValue = {
  state: AuthState;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const signIn = useCallback(async (session: Session) => {
    setAuthToken(session.token);
    await saveSession(session);
    setState({ status: 'signedIn', user: session.user });
  }, []);

  const signOut = useCallback(async () => {
    // Stop this account's pushes on this phone. Fire and forget: sign out must work offline. The request takes the
    // auth header now, before it's cleared below; a 401 reply can't loop back here because the token is gone by then.
    api('/me/push-token', { method: 'DELETE' }).catch(() => {});
    setAuthToken(null);
    void signOutOfSocial();
    await clearSession();
    await clearOnline().catch(() => {});
    queryClient.clear();
    setState({ status: 'signedOut' });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    loadSession()
      .then((session) => {
        if (!session) return setState({ status: 'signedOut' });
        setAuthToken(session.token);
        setState({ status: 'signedIn', user: session.user });
      })
      // Unreadable storage (keychain reset, corrupt data) must not leave the app on a blank screen.
      .catch(() => {
        void clearSession().catch(() => {});
        setState({ status: 'signedOut' });
      });
  }, [signOut]);

  return <AuthContext value={{ state, signIn, signOut }}>{children}</AuthContext>;
}

/**
 * Wraps an action that needs an account: a guest is sent to Sign in instead, and lands back on this screen once signed
 * in (Sign in closes itself), with what they entered kept, to tap again.
 */
export function useSignedIn() {
  const { state } = useAuth();
  const signedIn = state.status === 'signedIn';
  return useCallback(
    (action: () => void) => () => {
      if (signedIn) action();
      else router.push('/sign-in');
    },
    [signedIn],
  );
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
