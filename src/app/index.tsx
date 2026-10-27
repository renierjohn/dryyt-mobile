import { Redirect } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';

export default function Index() {
  const { state } = useAuth();
  // Guests browse the customer home; ordering asks them to sign in.
  if (state.status !== 'signedIn') return <Redirect href="/customer" />;
  const home = { customer: '/customer', driver: '/driver', owner: '/owner' } as const;
  return <Redirect href={home[state.user.role]} />;
}
