import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppLogo } from '@/components/app-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Primary-blue band at the top of a tab screen; pair with `<Screen edges={[]} header={…}>`. */
export function HeaderBand({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Dark status bar icons vanish on the blue band; tab screens stay mounted, so switch back when this one loses focus.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('auto');
    }, []),
  );
  return (
    <View style={[styles.band, { backgroundColor: theme.primary, paddingTop: insets.top + Spacing.three }]}>
      {/* White ring so the blue logo stands out on the blue band. */}
      <View style={styles.logoRing}>
        <AppLogo size={36} />
      </View>
      <ThemedText type="subtitle" style={{ color: theme.onPrimary }}>
        {title}
      </ThemedText>
      {subtitle && <ThemedText style={[styles.subtitle, { color: theme.onPrimary }]}>{subtitle}</ThemedText>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.one,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  logoRing: { alignSelf: 'flex-start', padding: 3, borderRadius: 999, backgroundColor: '#FFFFFF', marginBottom: Spacing.two },
  subtitle: { opacity: 0.85 },
});
