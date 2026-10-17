import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { MenuItemCard } from '@/components/menu-item-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MenuItem } from '@/lib/types';

const ROW_SIZE = 6;
const CARD_WIDTH = 120;

type Props<T extends MenuItem> = {
  title: string;
  items: T[] | undefined;
  onOpen: (item: T) => void;
  onMore: () => void;
  /** Shown under each card's name, e.g. the store on cross-store lists. */
  storeNameOf?: (item: T) => string;
};

/** A titled, sideways-scrolling row of up to 6 dish cards ending in a "More" tile; nothing when there are no items. */
export function MenuItemRow<T extends MenuItem>({ title, items, onOpen, onMore, storeNameOf }: Props<T>) {
  const theme = useTheme();
  if (!items?.length) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.slice(0, ROW_SIZE).map((item) => (
          <View key={item.id} style={styles.card}>
            <MenuItemCard item={item} storeName={storeNameOf?.(item)} compact onPress={() => onOpen(item)} />
          </View>
        ))}
        <Pressable
          onPress={onMore}
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
