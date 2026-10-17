import { Pressable, StyleSheet, View } from 'react-native';

import { MenuItemCard } from '@/components/menu-item-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PopularItem } from '@/lib/types';

const ROW_SIZE = 4;

/** Home's "Popular now": the top items in one row, or nothing when there are none. */
export function PopularRow({ items, onSeeAll, onOpen }: { items: PopularItem[] | undefined; onSeeAll: () => void; onOpen: (item: PopularItem) => void }) {
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Popular now</ThemedText>
        <Pressable onPress={onSeeAll}>
          <ThemedText type="linkPrimary">See all</ThemedText>
        </Pressable>
      </View>
      <View style={styles.row}>
        {items.slice(0, ROW_SIZE).map((item) => (
          <MenuItemCard key={item.id} item={item} storeName={item.store_name} compact onPress={() => onOpen(item)} />
        ))}
        {/* Keep card widths even when there are fewer than 4. */}
        {Array.from({ length: Math.max(0, ROW_SIZE - items.length) }, (_, i) => (
          <View key={`spacer-${i}`} style={styles.spacer} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', gap: Spacing.two },
  spacer: { flex: 1 },
});
