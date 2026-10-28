import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { VehicleBadge } from '@/components/vehicle-badge';
import { Spacing } from '@/constants/theme';
import type { VehicleFee } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { peso } from '@/lib/format';
import { vehicleLabel } from '@/lib/vehicles';

/**
 * One row per vehicle the area has a rate for: its base fare and the delivery fee for this trip. The customer picks
 * one and taps Proceed. Nothing is picked at first, so Proceed waits for a choice.
 */
export function VehicleOptions({
  options,
  roadKm,
  loading = false,
  onProceed,
}: {
  options: VehicleFee[];
  roadKm: number;
  loading?: boolean;
  onProceed: (option: VehicleFee) => void;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = options.find((o) => o.vehicle_type === picked) ?? null;
  return (
    <View style={styles.list}>
      <ThemedText type="smallBold">Choose a vehicle · {roadKm.toFixed(1)} km</ThemedText>
      <View accessibilityRole="radiogroup" style={styles.list}>
        {options.map((o) => {
          const active = o.vehicle_type === picked;
          return (
            <Pressable
              key={o.vehicle_type}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${vehicleLabel(o.vehicle_type)}, base fare ${peso(o.base_fee)}, delivery fee ${peso(o.total_delivery_fee)}`}
              onPress={() => setPicked(o.vehicle_type)}
              style={({ pressed }) => [
                styles.option,
                { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primarySoft : 'transparent', opacity: pressed ? 0.7 : 1 },
              ]}>
              <View style={[styles.radio, { borderColor: active ? theme.primary : theme.border }]}>
                {active && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
              </View>
              <VehicleBadge code={o.vehicle_type} size={40} />
              <View style={styles.grow}>
                <ThemedText type="smallBold">{vehicleLabel(o.vehicle_type)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Base fare {peso(o.base_fee)}
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{peso(o.total_delivery_fee)}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      <Button title="Proceed" disabled={!chosen} loading={loading} onPress={() => chosen && onProceed(chosen)} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  grow: { flex: 1 },
});
