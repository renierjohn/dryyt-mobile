import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { DriverVerification, VerifiedBadge } from '@/components/driver/driver-verification';
import { OwnerStores } from '@/components/owner-stores';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDriverVerification } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';

export function ProfileScreen() {
  const { state, signOut } = useAuth();
  if (state.status !== 'signedIn') return null;
  const { user } = state;
  const driver = user.role === 'driver';

  return (
    <Screen>
      <View style={styles.nameRow}>
        <ThemedText type="subtitle">{user.name}</ThemedText>
        {driver && <DriverBadge />}
      </View>
      <ThemedText>{user.email}</ThemedText>
      <ThemedText>{user.phone}</ThemedText>
      <ThemedText themeColor="textSecondary">{{ customer: 'Customer', driver: 'Driver', owner: 'Shop owner' }[user.role]}</ThemedText>
      {driver && <DriverVerification />}
      {user.role === 'owner' && <OwnerStores />}
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}

/** Shares the verification query with the card below, so no extra request. */
function DriverBadge() {
  return useDriverVerification().data?.verified ? <VerifiedBadge /> : null;
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
});
