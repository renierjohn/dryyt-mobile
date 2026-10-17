import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

type Props = { item: MenuItem; storeName?: string; onPress: () => void; compact?: boolean };

export const openMenuItem = (item: { id: number; store_id: number }) =>
  router.push({ pathname: '/customer/menu/[id]', params: { id: String(item.id), storeId: String(item.store_id) } });

/** Photo, name, store and price; cards in a row share the width. */
export function MenuItemCard({ item, storeName, onPress, compact = false }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
          <Icon name={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} size={compact ? 20 : 28} color={theme.primary} />
        </View>
      )}
      <ThemedText type={compact ? 'small' : 'smallBold'} numberOfLines={2}>
        {item.name}
      </ThemedText>
      {storeName && (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={compact && styles.compactText}>
          {storeName}
        </ThemedText>
      )}
      <View style={styles.prices}>
        <ThemedText type="smallBold" style={compact && styles.compactText}>
          {peso(discountedPrice(item))}
        </ThemedText>
        {item.discount_percent > 0 && !compact && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.struck}>
            {peso(item.price)}
          </ThemedText>
        )}
      </View>
      {item.discount_percent > 0 && compact && (
        <ThemedText type="small" themeColor="textSecondary" style={[styles.struck, styles.compactText]}>
          {peso(item.price)}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: 16, borderWidth: 1, padding: Spacing.two, gap: Spacing.one },
  photo: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  prices: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  struck: { textDecorationLine: 'line-through' },
  compactText: { fontSize: 12, lineHeight: 16 },
});
