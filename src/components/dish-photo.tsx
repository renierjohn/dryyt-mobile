import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';

type Props = { uri: string | null; size: number; testID: string };

/** A square dish photo, or a soft-blue fork-and-knife placeholder (testID + "-placeholder") when there is none. */
export function DishPhoto({ uri, size, testID }: Props) {
  const theme = useTheme();
  const box = { width: size, height: size, borderRadius: Math.round(size / 6) };
  if (uri) return <Image testID={testID} source={{ uri }} style={box} contentFit="cover" />;
  return (
    <View testID={`${testID}-placeholder`} style={[box, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
      <Icon name={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} size={Math.round(size * 0.42)} color={theme.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
});
