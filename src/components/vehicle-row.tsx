import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { vehicleIcon, vehicleLabel } from '@/lib/vehicles';

/** "Vehicle" with the booked vehicle's icon and name, for booking details. */
export function VehicleRow({ code }: { code: number }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText type="small" style={styles.grow}>
        Vehicle
      </ThemedText>
      <Icon name={vehicleIcon(code)} size={18} color={theme.textSecondary} />
      <ThemedText type="small">{vehicleLabel(code)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
