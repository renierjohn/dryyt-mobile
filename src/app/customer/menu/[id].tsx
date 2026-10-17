import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { CartButton } from '@/components/cart-button';
import { ErrorText } from '@/components/error-text';
import { MenuItemRow } from '@/components/menu-item-row';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useStore } from '@/hooks/queries';
import { confirmReplace, useCart } from '@/hooks/use-cart';
import { useTheme } from '@/hooks/use-theme';
import { discountedPrice, peso } from '@/lib/format';

export default function MenuItemScreen() {
  const params = useLocalSearchParams<{ id: string; storeId: string }>();
  const itemId = Number(params.id);
  const store = useStore(Number(params.storeId));
  const cart = useCart();
  const theme = useTheme();
  const [qty, setQty] = useState(1);

  const item = store.data?.menu.find((m) => m.id === itemId);
  if (!item || !store.data) {
    return (
      <Screen edges={[]}>
        {store.isPending ? <ActivityIndicator /> : <ErrorText error={store.error ?? new Error('This item is no longer on the menu.')} />}
      </Screen>
    );
  }

  const shop = { id: store.data.id, name: store.data.name };
  const openStore = () => router.push({ pathname: '/customer/new-order', params: { storeId: String(shop.id) } });
  // The menu arrives in the owner's sort_order; everything but this dish.
  const related = store.data.menu.filter((m) => m.id !== item.id);
  const add = () => {
    if (cart.add(item, shop, qty) === 'needs-replace') {
      confirmReplace(cart.store!.name, () => {
        cart.replace(item, shop, qty);
        router.back();
      });
      return;
    }
    router.back();
  };

  return (
    <View style={styles.fill}>
    <Screen edges={[]} footer={<Button title={`Add to cart · ${peso(discountedPrice(item) * qty)}`} onPress={add} />}>
      <Stack.Screen options={{ title: item.name }} />
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.placeholder, { backgroundColor: theme.primarySoft }]}>
          <Icon name={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} size={64} color={theme.primary} />
        </View>
      )}
      <View style={styles.info}>
        {item.best_seller && <StatusBadge label="Best seller" tone="info" />}
        <ThemedText type="subtitle">{item.name}</ThemedText>
        <Pressable onPress={openStore}>
          <ThemedText type="linkPrimary">{shop.name}</ThemedText>
        </Pressable>
        {item.category ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.category}
          </ThemedText>
        ) : null}
        <View style={styles.prices}>
          <ThemedText type="smallBold" style={styles.price}>
            {peso(discountedPrice(item))}
          </ThemedText>
          {item.discount_percent > 0 && (
            <ThemedText themeColor="textSecondary" style={styles.struck}>
              {peso(item.price)}
            </ThemedText>
          )}
        </View>
      </View>
      <View style={styles.stepper}>
        <StepButton symbol="−" onPress={() => setQty((q) => Math.max(1, q - 1))} />
        <ThemedText type="subtitle" style={styles.count}>
          {qty}
        </ThemedText>
        <StepButton symbol="+" onPress={() => setQty((q) => Math.min(50, q + 1))} />
      </View>
      <MenuItemRow
        title={`More from ${shop.name}`}
        items={related}
        onOpen={(m) => router.push({ pathname: '/customer/menu/[id]', params: { id: String(m.id), storeId: String(shop.id) } })}
        onMore={openStore}
      />
    </Screen>
    <CartButton bottom={84} />
    </View>
  );
}

function StepButton({ symbol, onPress }: { symbol: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.step, { backgroundColor: theme.primarySoft }]} accessibilityRole="button">
      <ThemedText type="subtitle" style={{ color: theme.primary }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 16 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  info: { gap: Spacing.one, alignItems: 'flex-start' },
  prices: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  price: { fontSize: 20, lineHeight: 28 },
  struck: { textDecorationLine: 'line-through' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  step: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 40, textAlign: 'center' },
});
