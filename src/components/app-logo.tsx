import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

export function AppLogo({ size = 48 }: { size?: number }) {
  return (
    <Image
      source={require('@/assets/images/logo.png')}
      style={[styles.logo, { width: size, height: size }]}
      contentFit="contain"
      accessibilityLabel="Dryyt"
    />
  );
}

const styles = StyleSheet.create({
  logo: { alignSelf: 'center' },
});
