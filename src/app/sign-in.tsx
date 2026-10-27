import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { FacebookLogo, GoogleLogo } from '@/components/brand-logos';
import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import { signInWithFacebook, signInWithGoogle } from '@/lib/social-auth';
import type { Session } from '@/lib/session-storage';

/** Also the customer Login tab, for guests browsing the home screen. */
export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<Session>('/auth/login', { body: { email, password } }),
    onSuccess: signIn,
  });
  // Null when the Google account picker or Facebook login was closed: nothing to do.
  const google = useMutation({
    mutationFn: signInWithGoogle,
    onSuccess: (session) => session && signIn(session),
  });
  const facebook = useMutation({
    mutationFn: signInWithFacebook,
    onSuccess: (session) => session && signIn(session),
  });
  const busy = login.isPending || google.isPending || facebook.isPending;

  return (
    <Screen>
      <ThemedText type="subtitle">Dryyt</ThemedText>
      <ThemedText themeColor="textSecondary">Sign in to continue</ThemedText>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <ErrorText error={login.error ?? google.error ?? facebook.error} />
      <Button title="Sign in" onPress={() => login.mutate()} loading={login.isPending} disabled={busy} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.or}>
        or
      </ThemedText>
      <Button
        title="Continue with Google"
        variant="outline"
        leading={<GoogleLogo />}
        onPress={() => google.mutate()}
        loading={google.isPending}
        disabled={busy}
      />
      <Button
        title="Continue with Facebook"
        variant="outline"
        leading={<FacebookLogo />}
        onPress={() => facebook.mutate()}
        loading={facebook.isPending}
        disabled={busy}
      />
      <Link href="/sign-up">
        <ThemedText type="linkPrimary">No account? Create one</ThemedText>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  or: { textAlign: 'center' },
});
