import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  /** Drawn before the title, in the title's colour. */
  icon?: IconName;
  /** Drawn before the title as is, e.g. a brand logo in its own colours. Wins over `icon`. */
  leading?: ReactNode;
  /** Just the icon, for narrow slots; `title` is still read out by screen readers. */
  iconOnly?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Waiting on something else first (e.g. the location): a spinner before the title, and disabled. */
  waiting?: boolean;
  /** Square corners instead of a pill. */
  square?: boolean;
};

export function Button({ title, onPress, variant = 'primary', icon, leading, iconOnly = false, disabled = false, loading = false, waiting = false, square = false }: Props) {
  const theme = useTheme();
  const look = {
    primary: { background: theme.primary, color: theme.onPrimary, border: theme.primary },
    secondary: { background: theme.primarySoft, color: theme.primary, border: theme.primarySoft },
    outline: { background: 'transparent', color: theme.text, border: theme.border },
    danger: { background: theme.danger, color: '#ffffff', border: theme.danger },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading || waiting}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.button,
        iconOnly && styles.iconOnly,
        square && styles.square,
        {
          // Primary darkens while pressed; the lighter variants fade instead.
          backgroundColor: pressed && variant === 'primary' ? theme.primaryPressed : look.background,
          borderColor: look.border,
          opacity: disabled ? 0.5 : pressed && variant !== 'primary' ? 0.8 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={look.color} />
      ) : (
        <View style={styles.content}>
          {waiting && <ActivityIndicator testID="button-waiting" size="small" color={look.color} />}
          {leading && !waiting && <View testID="button-icon">{leading}</View>}
          {icon && !leading && !waiting && (
            <View testID="button-icon">
              <Icon name={icon} size={iconOnly ? 22 : 18} color={look.color} />
            </View>
          )}
          {!iconOnly && (
            // Two lines, not one: Android can measure bold text a little short, which cut the end off long titles.
            <ThemedText type="smallBold" style={[styles.title, { color: look.color }]} numberOfLines={2}>
              {title}
            </ThemedText>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, maxWidth: '100%' },
  title: { flexShrink: 1, textAlign: 'center' },
  iconOnly: { paddingHorizontal: Spacing.one },
  square: { borderRadius: 0 },
});
