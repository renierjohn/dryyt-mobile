import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { DriverVerification, VerifiedBadge } from '@/components/driver/driver-verification';
import { OwnerStores } from '@/components/owner-stores';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDriverVerification } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { vehicleLabel } from '@/lib/vehicles';

export function ProfileScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== 'signedIn') return null;
  const { user } = state;
  const driver = user.role === 'driver';
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <Screen>
      <View style={styles.header}>
        <Avatar name={user.name} size={64} />
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <ThemedText type="subtitle">{user.name}</ThemedText>
            {driver && <DriverBadge />}
          </View>
          <ThemedText themeColor="textSecondary">{{ customer: 'Customer', driver: 'Driver', owner: 'Shop owner' }[user.role]}</ThemedText>
        </View>
      </View>
      {editing ? (
        <ContactForm user={user} onDone={() => setEditing(false)} />
      ) : (
        <Card>
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Phone" value={user.phone} />
          {driver && <VehicleRow />}
          {user.role === 'customer' && (
            <Button title="Edit email and phone" variant="secondary" icon={{ ios: 'pencil', android: 'edit', web: 'edit' }} onPress={() => setEditing(true)} />
          )}
        </Card>
      )}
      {changingPassword ? (
        <PasswordForm onDone={() => setChangingPassword(false)} />
      ) : (
        <Button title="Change password" variant="secondary" icon={{ ios: 'lock', android: 'lock', web: 'lock' }} onPress={() => setChangingPassword(true)} />
      )}
      {driver && <DriverVerification />}
      {user.role === 'owner' && <OwnerStores />}
      <Button title="Sign out" variant="outline" onPress={signOut} />
    </Screen>
  );
}

/** Email and phone, saved to the account and to this phone's session. */
function ContactForm({ user, onDone }: { user: User; onDone: () => void }) {
  const { updateUser } = useAuth();
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const save = useMutation({
    mutationFn: () => api<{ user: User }>('/me', { method: 'PATCH', body: { email, phone } }),
    onSuccess: async (res) => {
      await updateUser(res.user);
      onDone();
    },
  });

  return (
    <Card>
      <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
      <ErrorText error={save.error} />
      <View style={styles.actions}>
        <View style={styles.grow}>
          <Button title="Cancel" variant="outline" onPress={onDone} disabled={save.isPending} />
        </View>
        <View style={styles.grow}>
          <Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={email.trim() === '' || phone.trim() === ''} />
        </View>
      </View>
    </Card>
  );
}

/** A new password, typed twice. */
function PasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saved, setSaved] = useState(false);
  // Shown once the second field has something in it, so it doesn't nag while the first is still being typed.
  const mismatch = confirm !== '' && confirm !== password;
  const save = useMutation({
    mutationFn: () => api('/me/password', { body: { password } }),
    onSuccess: () => setSaved(true),
  });

  if (saved) {
    return (
      <Card>
        <ThemedText type="smallBold">Password changed</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Use your new password the next time you sign in.
        </ThemedText>
        <Button title="Done" variant="outline" onPress={onDone} />
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">Change password</ThemedText>
      <TextField label="New password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      {mismatch && <ErrorText error={new Error('Passwords do not match')} />}
      <ErrorText error={save.error} />
      <View style={styles.actions}>
        <View style={styles.grow}>
          <Button title="Cancel" variant="outline" onPress={onDone} disabled={save.isPending} />
        </View>
        <View style={styles.grow}>
          <Button
            title="Save"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={password.length < 8 || confirm !== password}
          />
        </View>
      </View>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

/** Shares the verification query with the card below, so no extra request. */
function VehicleRow() {
  const v = useDriverVerification().data;
  return v ? <InfoRow label="Vehicle" value={vehicleLabel(v.vehicle_type)} /> : null;
}

/** Shares the verification query with the card below, so no extra request. */
function DriverBadge() {
  return useDriverVerification().data?.verified ? <VerifiedBadge /> : null;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
