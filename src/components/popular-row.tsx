import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { MenuItemCard } from '@/components/menu-item-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PopularItem } from '@/lib/types';

const ROW_SIZE = 6;
const CARD_WIDTH = 120;

/** Home's "Popular now": the top items in a sideways-scrolling row ending in "More" (See all), or nothing when there are none. */
export function PopularRow({ items, onSeeAll, onOpen }: { items: PopularItem[] | undefined; onSeeAll: () => void; onOpen: (item: PopularItem) => void }) {
  const theme = useTheme();
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Popular now</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.slice(0, ROW_SIZE).map((item) => (
          <View key={item.id} style={styles.card}>
            <MenuItemCard item={item} storeName={item.store_name} compact onPress={() => onOpen(item)} />
          </View>
        ))}
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          style={({ pressed }) => [styles.card, styles.more, { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 }]}>
          <Icon name={{ ios: 'arrow.right.circle.fill', android: 'arrow_circle_right', web: 'arrow_circle_right' }} size={32} color={theme.primary} />
          <ThemedText type="smallBold" style={{ color: theme.primary }}>
            More
          </ThemedText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: { gap: Spacing.two },
  card: { width: CARD_WIDTH },
  more: { borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
});
