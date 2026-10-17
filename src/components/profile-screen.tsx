import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
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
      <Card>
        <InfoRow label="Email" value={user.email} />
        <InfoRow label="Phone" value={user.phone} />
      </Card>
      {driver && <DriverVerification />}
      {user.role === 'owner' && <OwnerStores />}
      <Button title="Sign out" variant="outline" onPress={signOut} />
    </Screen>
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
function DriverBadge() {
  return useDriverVerification().data?.verified ? <VerifiedBadge /> : null;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
});
