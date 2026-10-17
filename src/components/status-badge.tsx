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
