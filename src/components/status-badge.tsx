import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

/** Status pill coloured by `tone`. */
export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const theme = useTheme();
  const colors = {
    success: { text: theme.success, background: theme.successSoft },
    warning: { text: theme.warning, background: theme.warningSoft },
    danger: { text: theme.danger, background: theme.dangerSoft },
    info: { text: theme.primary, background: theme.primarySoft },
    muted: { text: theme.textSecondary, background: theme.backgroundSelected },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.background }]}>
      {/* A real bold face: Android measured weight 600 with another face and clipped the last word ("Waiting for a"). */}
      <ThemedText type="smallBold" style={[styles.badgeText, { color: colors.text }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shrinks (and wraps) rather than overflowing a row.
  badge: { flexShrink: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  badgeText: { fontSize: 12, lineHeight: 16 },
});
