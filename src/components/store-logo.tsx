import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';

/** A round store logo, or a soft-blue storefront placeholder (testID + "-placeholder"); data from before store_logo was added has none. */
export function StoreLogo({ uri, size = 20, testID }: { uri: string | null | undefined; size?: number; testID: string }) {
  const theme = useTheme();
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image testID={testID} source={{ uri }} style={circle} contentFit="cover" />;
  return (
    <View testID={`${testID}-placeholder`} style={[circle, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
      <Icon name={{ ios: 'storefront.fill', android: 'storefront', web: 'storefront' }} size={Math.round(size * 0.6)} color={theme.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
