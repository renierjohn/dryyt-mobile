import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** − count + in soft blue pills; `onChange` gets the step (−1 or +1). */
export function Stepper({ value, onChange }: { value: number; onChange: (delta: number) => void }) {
  const theme = useTheme();
  const step = (symbol: string, delta: number) => (
    <Pressable onPress={() => onChange(delta)} style={[styles.step, { backgroundColor: theme.primarySoft }]} accessibilityRole="button">
      <ThemedText type="smallBold" style={{ color: theme.primary }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {step('−', -1)}
      <ThemedText type="smallBold" style={styles.count}>
        {value}
      </ThemedText>
      {step('+', 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  step: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 24, textAlign: 'center' },
});
