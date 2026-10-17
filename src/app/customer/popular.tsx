import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { CartButton } from '@/components/cart-button';
import { ErrorText } from '@/components/error-text';
import { MenuItemCard, openMenuItem } from '@/components/menu-item-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePopularMenu } from '@/hooks/queries';
import type { PopularItem } from '@/lib/types';

const COLUMNS = 2;

export default function Popular() {
  const popular = usePopularMenu(50);
  const items = popular.data ?? [];
  const rows: PopularItem[][] = [];
  for (let i = 0; i < items.length; i += COLUMNS) rows.push(items.slice(i, i + COLUMNS));

  return (
    <View style={styles.fill}>
      <Screen edges={[]} onRefresh={popular.refetch}>
        {popular.isPending && <ActivityIndicator />}
        <ErrorText error={popular.error} />
        {popular.isSuccess && items.length === 0 && <ThemedText themeColor="textSecondary">Nothing on the menu yet.</ThemedText>}
        {rows.map((row) => (
          <View key={row[0].id} style={styles.row}>
            {row.map((item) => (
              <MenuItemCard key={item.id} item={item} storeName={item.store_name} onPress={() => openMenuItem(item)} />
            ))}
            {row.length < COLUMNS && <View style={styles.fill} />}
          </View>
        ))}
      </Screen>
      <CartButton />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.three },
});
