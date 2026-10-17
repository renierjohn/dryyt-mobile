import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Tone = 'success' | 'warning' | 'danger' | 'muted';

/** Status pill coloured by `tone`. */
export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const theme = useTheme();
  const colors = {
    success: { text: Brand.success, background: 'rgba(48, 164, 108, 0.15)' },
    warning: { text: Brand.warning, background: 'rgba(245, 165, 36, 0.15)' },
    danger: { text: Brand.danger, background: 'rgba(229, 72, 77, 0.15)' },
    muted: { text: theme.textSecondary, background: theme.backgroundSelected },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.background }]}>
      <ThemedText type="small" style={[styles.badgeText, { color: colors.text }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
