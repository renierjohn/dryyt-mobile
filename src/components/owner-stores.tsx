import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useDeleteStore, useOwnerStores } from '@/hooks/queries';
import type { Store } from '@/lib/types';

/** The owner's shops: tap to edit, trash to delete, button to add. */
export function OwnerStores() {
  const stores = useOwnerStores();
  const remove = useDeleteStore();

  const confirmDelete = (store: Store) =>
    Alert.alert('Delete shop?', `${store.name} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(store.id) },
    ]);

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">My shops</ThemedText>
      {stores.isPending && <ActivityIndicator />}
      <ErrorText error={stores.error ?? remove.error} />
      {stores.isSuccess && stores.data.length === 0 && <ThemedText themeColor="textSecondary">No shops yet.</ThemedText>}
      {stores.data?.map((store) => (
        <Card key={store.id} onPress={() => router.push({ pathname: '/owner/store/[id]', params: { id: String(store.id) } })}>
          <View style={styles.row}>
            <View style={styles.text}>
              <ThemedText type="smallBold">{store.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {store.type === 'laundry' ? 'Laundry' : 'Food'} · {store.address}
              </ThemedText>
            </View>
            {remove.isPending && remove.variables === store.id ? (
              <ActivityIndicator />
            ) : (
              <Pressable onPress={() => confirmDelete(store)} hitSlop={12} accessibilityLabel={`Delete ${store.name}`}>
                <Icon name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={22} color={Brand.danger} />
              </Pressable>
            )}
          </View>
        </Card>
      ))}
      <Button title="Add shop" onPress={() => router.push({ pathname: '/owner/store/[id]', params: { id: 'new' } })} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  text: { flex: 1 },
});
