import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppLogo } from '@/components/app-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** Shown faintly behind the text (e.g. a store's logo); the logo circle shows it too. */
  backgroundImage?: string | null;
  /** False under a navigation bar, which already clears the status bar. */
  inset?: boolean;
};

/** Primary-blue band at the top of a screen; pair with `<Screen edges={[]} header={…}>`. */
export function HeaderBand({ title, subtitle, children, backgroundImage, inset = true }: Props) {
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
    <View style={[styles.band, { backgroundColor: theme.primary, paddingTop: (inset ? insets.top : 0) + Spacing.three }]}>
      {backgroundImage && (
        // Faint, so the white text on the blue band stays readable.
        <Image testID="band-background" source={{ uri: backgroundImage }} style={styles.background} contentFit="cover" />
      )}
      {/* White ring so the logo stands out on the blue band. */}
      <View style={styles.logoRing}>
        {backgroundImage ? <Image source={{ uri: backgroundImage }} style={styles.logo} contentFit="cover" /> : <AppLogo size={36} />}
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
    overflow: 'hidden',
  },
  background: { ...StyleSheet.absoluteFill, opacity: 0.2 },
  logo: { width: 36, height: 36, borderRadius: 18 },
  logoRing: { alignSelf: 'flex-start', padding: 3, borderRadius: 999, backgroundColor: '#FFFFFF', marginBottom: Spacing.two },
  subtitle: { opacity: 0.85 },
});
