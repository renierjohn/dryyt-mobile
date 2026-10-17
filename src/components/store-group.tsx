import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { MenuItemCard } from '@/components/menu-item-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PopularItem } from '@/lib/types';

export type StoreGroupData = { storeId: number; storeName: string; storeLogo: string | null; items: PopularItem[] };

const COLUMNS = 2;

/** Items per store, stores in the order of their first item (so the store with the most popular match leads). */
export function groupByStore(items: PopularItem[]): StoreGroupData[] {
  const groups = new Map<number, StoreGroupData>();
  for (const item of items) {
    const group = groups.get(item.store_id) ?? { storeId: item.store_id, storeName: item.store_name, storeLogo: item.store_logo, items: [] };
    group.items.push(item);
    groups.set(item.store_id, group);
  }
  return [...groups.values()];
}

type Props = { group: StoreGroupData; onOpenStore: (storeId: number) => void; onOpenItem: (item: PopularItem) => void };

/** A tappable store header over its items in a 2-column grid. */
export function StoreGroup({ group, onOpenStore, onOpenItem }: Props) {
  const theme = useTheme();
  const rows: PopularItem[][] = [];
  for (let i = 0; i < group.items.length; i += COLUMNS) rows.push(group.items.slice(i, i + COLUMNS));

  return (
    <View style={styles.group}>
      <Pressable
        onPress={() => onOpenStore(group.storeId)}
        accessibilityRole="link"
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}>
        {group.storeLogo ? (
          <Image source={{ uri: group.storeLogo }} style={styles.logo} contentFit="cover" />
        ) : (
          <View style={[styles.logo, styles.logoPlaceholder, { backgroundColor: theme.primarySoft }]}>
            <Icon name={{ ios: 'storefront.fill', android: 'storefront', web: 'storefront' }} size={18} color={theme.primary} />
          </View>
        )}
        <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
          {group.storeName}
        </ThemedText>
        <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} color={theme.textSecondary} />
      </Pressable>
      {rows.map((row) => (
        <View key={row[0].id} style={styles.row}>
          {row.map((item) => (
            <MenuItemCard key={item.id} item={item} onPress={() => onOpenItem(item)} />
          ))}
          {row.length < COLUMNS && <View style={styles.spacer} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  logo: { width: 32, height: 32, borderRadius: 16 },
  logoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.three },
  spacer: { flex: 1 },
});
