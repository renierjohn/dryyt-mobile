import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';
import { vehicleIcon } from '@/lib/vehicles';

/** The vehicle's icon in white on a primary-blue circle, like the Dryyt logo. */
export function VehicleBadge({ code, size = 40 }: { code: number | null | undefined; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.primary }]}>
      <Icon name={vehicleIcon(code)} size={Math.round(size * 0.58)} color={theme.onPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
