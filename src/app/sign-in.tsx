import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Session } from '@/lib/session-storage';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<Session>('/auth/login', { body: { email, password } }),
    onSuccess: signIn,
  });

  return (
    <Screen>
      <ThemedText type="subtitle">Dryyt</ThemedText>
      <ThemedText themeColor="textSecondary">Sign in to continue</ThemedText>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <ErrorText error={login.error} />
      <Button title="Sign in" onPress={() => login.mutate()} loading={login.isPending} />
      <Link href="/sign-up">
        <ThemedText type="linkPrimary">No account? Create one</ThemedText>
      </Link>
    </Screen>
  );
}
