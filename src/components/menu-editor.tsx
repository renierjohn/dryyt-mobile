import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { DishPhoto } from '@/components/dish-photo';
import { SortableList } from '@/components/sortable-list';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useDeleteMenuItem, useReorderMenu, useStore } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

/** Card (80) + gap; each card is clipped to one line of name and one of details so every row fits. */
const ROW_HEIGHT = 88;

const editItem = (storeId: number, itemId: number | 'new') =>
  router.push({
    pathname: '/owner/menu-item',
    params: { storeId: String(storeId), itemId: String(itemId) },
  });

/** A food shop's menu: tap to edit, trash to delete, button to add. */
export function MenuEditor({ storeId }: { storeId: number }) {
  const store = useStore(storeId);
  const remove = useDeleteMenuItem(storeId);
  const reorder = useReorderMenu(storeId);
  const theme = useTheme();

  const confirmDelete = (item: MenuItem) =>
    Alert.alert('Delete item?', `${item.name} will be removed from the menu.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate(item.id),
      },
    ]);

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Menu</ThemedText>
      {store.isPending && <ActivityIndicator />}
      <ErrorText error={store.error ?? remove.error ?? reorder.error} />
      {store.isSuccess && store.data.menu.length === 0 && <ThemedText themeColor="textSecondary">No items yet.</ThemedText>}
      {store.data && (
        <SortableList
          items={store.data.menu}
          rowHeight={ROW_HEIGHT}
          onReorder={(ids) => reorder.mutate(ids)}
          renderItem={(item, handle) => (
            <Card style={styles.card} onPress={() => editItem(storeId, item.id)}>
              <View style={styles.row}>
                {handle(
                  <View style={styles.handle} accessibilityLabel={`Drag to reorder ${item.name}`}>
                    <Icon name={{ ios: 'line.3.horizontal', android: 'drag_handle', web: 'drag_handle' }} size={24} color={theme.textSecondary} />
                  </View>,
                )}
                {/* The item's photo, or a placeholder so every row lines up. */}
                <DishPhoto uri={item.image_url} size={48} testID={`menu-photo-${item.id}`} />
                <View style={styles.text}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.name}
                    {item.best_seller ? ' · Best seller' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[item.category, peso(discountedPrice(item)), item.discount_percent > 0 && `${item.discount_percent}% off`]
                      .filter(Boolean)
                      .join(' · ')}
                  </ThemedText>
                </View>
                {remove.isPending && remove.variables === item.id ? (
                  <ActivityIndicator />
                ) : (
                  <Pressable onPress={() => confirmDelete(item)} hitSlop={12} accessibilityLabel={`Delete ${item.name}`}>
                    <Icon name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={22} color={Brand.danger} />
                  </Pressable>
                )}
              </View>
            </Card>
          )}
        />
      )}
      {store.data && store.data.menu.length > 1 && (
        <ThemedText type="small" themeColor="textSecondary">
          Drag ≡, or hold an item then drag, to change the order customers see.
        </ThemedText>
      )}
      <Button title="Add menu" onPress={() => editItem(storeId, 'new')} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  card: { height: ROW_HEIGHT - Spacing.two, justifyContent: 'center' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
  /** Fills the card's height on the left edge: a big, easy target. */
  handle: {
    alignSelf: 'stretch',
    width: 44,
    marginVertical: -Spacing.three,
    marginLeft: -Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
