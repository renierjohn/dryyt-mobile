import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import { discountedPrice } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

export type CartStore = { id: number; name: string };
export type CartLine = { item: MenuItem; qty: number };
type Cart = { store: CartStore | null; lines: CartLine[] };

const MAX_QTY = 50;
const EMPTY: Cart = { store: null, lines: [] };
const clamp = (qty: number) => Math.min(MAX_QTY, Math.max(0, qty));

function useCartState() {
  const [cart, setCart] = useState<Cart>(EMPTY);

  return useMemo(() => {
    const addTo = (base: Cart, item: MenuItem, store: CartStore, qty: number): Cart => {
      const existing = base.lines.find((l) => l.item.id === item.id);
      const lines = existing
        ? base.lines.map((l) => (l.item.id === item.id ? { ...l, qty: clamp(l.qty + qty) } : l))
        : [...base.lines, { item, qty: clamp(qty) }];
      return { store, lines };
    };

    return {
      ...cart,
      count: cart.lines.reduce((sum, l) => sum + l.qty, 0),
      itemsTotal: cart.lines.reduce((sum, l) => sum + discountedPrice(l.item) * l.qty, 0),
      qtyOf: (itemId: number) => cart.lines.find((l) => l.item.id === itemId)?.qty ?? 0,
      /** One store per cart: from another store, nothing changes and the caller asks (see `confirmReplace`). */
      add: (item: MenuItem, store: CartStore, qty: number): 'added' | 'needs-replace' => {
        if (cart.store && cart.store.id !== store.id) return 'needs-replace';
        setCart((c) => addTo(c, item, store, qty));
        return 'added';
      },
      replace: (item: MenuItem, store: CartStore, qty: number) => setCart(addTo(EMPTY, item, store, qty)),
      setQty: (itemId: number, qty: number) =>
        setCart((c) => {
          const lines = c.lines.map((l) => (l.item.id === itemId ? { ...l, qty: clamp(qty) } : l)).filter((l) => l.qty > 0);
          return lines.length ? { ...c, lines } : EMPTY;
        }),
      clear: () => setCart(EMPTY),
    };
  }, [cart]);
}

const CartContext = createContext<ReturnType<typeof useCartState> | null>(null);

/** The customer's cart, shared by Home, the menu screens and checkout. Memory only. */
export function CartProvider({ children }: { children: ReactNode }) {
  return <CartContext.Provider value={useCartState()}>{children}</CartContext.Provider>;
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart needs a CartProvider');
  return cart;
}

/** Asks before an item from another store clears the cart. */
export function confirmReplace(current: string, onConfirm: () => void) {
  Alert.alert('Start a new cart?', `Your cart from ${current} will be cleared.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Start new cart', style: 'destructive', onPress: onConfirm },
  ]);
}
