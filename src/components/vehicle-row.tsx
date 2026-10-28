import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { VehicleBadge } from '@/components/vehicle-badge';
import { Spacing } from '@/constants/theme';
import { vehicleLabel } from '@/lib/vehicles';

/** "Vehicle" with the booked vehicle's icon and name, for booking details. */
export function VehicleRow({ code }: { code: number }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" style={styles.grow}>
        Vehicle
      </ThemedText>
      <VehicleBadge code={code} size={24} />
      <ThemedText type="small">{vehicleLabel(code)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
