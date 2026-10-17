import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false }: Props) {
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
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        {
          // Primary darkens while pressed; the lighter variants fade instead.
          backgroundColor: pressed && variant === 'primary' ? theme.primaryPressed : look.background,
          borderColor: look.border,
          opacity: disabled ? 0.5 : pressed && variant !== 'primary' ? 0.8 : 1,
        },
      ]}>
      {loading ? <ActivityIndicator color={look.color} /> : <ThemedText type="smallBold" style={{ color: look.color }}>{title}</ThemedText>}
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
});
