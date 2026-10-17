import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCart } from '@/hooks/use-cart';
import { useTheme } from '@/hooks/use-theme';
import { peso } from '@/lib/format';

/** Floating "n items · ₱total" pill that opens the cart; hidden while the cart is empty. Place last in the screen. */
export function CartButton({ bottom = 0 }: { bottom?: number }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  if (cart.count === 0) return null;
  return (
    <Pressable
      onPress={() => router.push('/customer/cart')}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.pill,
        // Secondary look, like Button variant="secondary": fades while pressed.
        { backgroundColor: theme.primarySoft, opacity: pressed ? 0.8 : 1, bottom: bottom + insets.bottom + Spacing.three },
      ]}>
      <Icon name={{ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }} size={20} color={theme.primary} />
      <ThemedText type="smallBold" style={{ color: theme.primary }}>
        {cart.count} {cart.count === 1 ? 'item' : 'items'} · {peso(cart.itemsTotal)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.2)',
  },
});
