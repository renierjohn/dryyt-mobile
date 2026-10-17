import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = { storeName: string | null; onConfirm: () => void; onCancel: () => void };

/** Asks before an item from another store clears the cart; open while `storeName` is set. */
export function ReplaceCartDialog({ storeName, onConfirm, onCancel }: Props) {
  const theme = useTheme();
  return (
    <Modal visible={storeName !== null} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable testID="replace-cart-backdrop" style={styles.backdrop} onPress={onCancel}>
        {/* Swallow taps on the card so only the backdrop cancels. */}
        <Pressable style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]} onPress={() => {}}>
          <View style={[styles.iconCircle, { backgroundColor: theme.primarySoft }]}>
            <Icon name={{ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }} size={28} color={theme.primary} />
          </View>
          <ThemedText type="smallBold" style={styles.title}>
            Start a new cart?
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
            Your cart from {storeName} will be cleared. Since order is from another store.
          </ThemedText>
          <View style={styles.actions}>
            <Button title="Start new cart" variant="danger" onPress={onConfirm} />
            <Button title="Keep my cart" variant="outline" onPress={onCancel} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  card: { width: '100%', maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: Spacing.four, alignItems: 'center', gap: Spacing.two },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, lineHeight: 24, textAlign: 'center' },
  body: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.two },
});
