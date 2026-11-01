import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet } from 'react-native';

/**
 * memo: the navigation header (react-navigation, which the React Compiler doesn't touch) calls `headerTitle()` on every
 * header render, so it hands this a new element each time; with the same `size` there's nothing to redraw.
 */
export const AppLogo = memo(function AppLogo({ size = 48 }: { size?: number }) {
  return (
    <Image
      source={require('@/assets/images/logo.png')}
      style={[styles.logo, { width: size, height: size }]}
      contentFit="contain"
      accessibilityLabel="Dryyt"
    />
  );
});

const styles = StyleSheet.create({
  logo: { alignSelf: 'center' },
});
