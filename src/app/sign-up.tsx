import { useMutation } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorText } from '@/components/error-text';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { Session } from '@/lib/session-storage';
import type { Role } from '@/lib/types';

export default function SignUp() {
  const { signIn } = useAuth();
  const [role, setRole] = useState<Role>('customer');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Shown once the second field has something in it, so it doesn't nag while the first is still being typed.
  const mismatch = confirm !== '' && confirm !== password;
  const register = useMutation({
    mutationFn: () => api<Session>('/auth/register', { body: { role, name, phone, email, password } }),
    onSuccess: signIn,
  });

  return (
    <Screen>
      <ThemedText type="subtitle">Create account</ThemedText>
      <View style={styles.roles}>
        {(['customer', 'driver', 'owner'] as const).map((r) => (
          <View key={r} style={styles.role}>
            <Button
              title={r === 'customer' ? 'Customer' : r === 'driver' ? 'Driver' : 'Shop owner'}
              variant={role === r ? 'primary' : 'secondary'}
              onPress={() => setRole(r)}
            />
          </View>
        ))}
      </View>
      <TextField label="Name" value={name} onChangeText={setName} autoComplete="name" />
      <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <TextField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      {mismatch && <ErrorText error={new Error('Passwords do not match')} />}
      <ErrorText error={register.error} />
      <Button
        title="Create account"
        onPress={() => register.mutate()}
        loading={register.isPending}
        disabled={password === '' || confirm !== password}
      />
      <Link href="/sign-in">
        <ThemedText type="linkPrimary">Already have an account? Sign in</ThemedText>
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  roles: { flexDirection: 'row', gap: Spacing.two },
  role: { flex: 1 },
});
