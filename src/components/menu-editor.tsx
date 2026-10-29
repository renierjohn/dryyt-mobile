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
import { useDeleteMenuItem, useReorderMenu, useSaveMenuItem, useStore } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

/** Card (104) + gap; each card is clipped to the Sold Out line, one line of name and one of details so every row fits. */
const ROW_HEIGHT = 112;

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
                <View style={item.sold_out && styles.soldOut}>
                  <DishPhoto uri={item.image_url} size={48} testID={`menu-photo-${item.id}`} />
                </View>
                <View style={styles.text}>
                  <SoldOutCheckbox storeId={storeId} item={item} />
                  <ThemedText type="smallBold" numberOfLines={1} style={item.sold_out && styles.soldOut}>
                    {item.name}
                    {item.best_seller ? ' · Best seller' : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={item.sold_out && styles.soldOut}>
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

/** Saves right away; customers see a sold out item dimmed and can't add it to the cart. */
function SoldOutCheckbox({ storeId, item }: { storeId: number; item: MenuItem }) {
  const save = useSaveMenuItem(storeId, item.id);
  const theme = useTheme();
  // Shows the new state while it saves.
  const checked = save.isPending ? !!save.variables?.sold_out : item.sold_out;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: save.isPending }}
      accessibilityLabel={`Sold Out: ${item.name}`}
      disabled={save.isPending}
      onPress={() => {
        const { name, price, image_url, discount_percent, category, best_seller } = item;
        save.mutate({ name, price, image_url, discount_percent, category, best_seller, sold_out: !item.sold_out });
      }}
      hitSlop={12}
      style={styles.check}>
      <Icon
        name={
          checked
            ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' }
            : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }
        }
        size={26}
        color={checked ? theme.primary : theme.textSecondary}
      />
      <ThemedText type="smallBold" themeColor={checked ? undefined : 'textSecondary'}>
        Sold Out
      </ThemedText>
      {save.isError && <Icon name={{ ios: 'exclamationmark.circle', android: 'error', web: 'error' }} size={16} color={Brand.danger} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  card: { height: ROW_HEIGHT - Spacing.two, justifyContent: 'center' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'flex-start', paddingRight: Spacing.two },
  soldOut: { opacity: 0.7 },
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
