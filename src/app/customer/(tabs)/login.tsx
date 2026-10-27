import { Redirect } from 'expo-router';

import SignIn from '@/app/sign-in';
import { useAuth } from '@/hooks/use-auth';

/** Guests' Login tab: the sign in form. Once signed in this tab is hidden, so go back to Home. */
export default function LoginTab() {
  const { state } = useAuth();
  if (state.status === 'signedIn') return <Redirect href="/customer" />;
  return <SignIn />;
}
