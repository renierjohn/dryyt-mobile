import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** "or" with a line on both sides, between two ways to do the same thing (e.g. a reference number or a photo). */
export function OrDivider() {
  const theme = useTheme();
  return (
    <View testID="or-divider" style={styles.or}>
      <View style={[styles.line, { backgroundColor: theme.border }]} />
      <ThemedText type="small" themeColor="textSecondary">
        or
      </ThemedText>
      <View style={[styles.line, { backgroundColor: theme.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  or: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
