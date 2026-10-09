import { Redirect } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';

export default function Index() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') return <Redirect href="/sign-in" />;
  const home = { customer: '/customer', driver: '/driver', owner: '/owner' } as const;
  return <Redirect href={home[state.user.role]} />;
}
