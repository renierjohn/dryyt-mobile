import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { ReplaceCartDialog } from '@/components/replace-cart-dialog';

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

type CartContextValue = ReturnType<typeof useCartState> & {
  /** Asks before an item from another store clears the cart; `onConfirm` runs only if the customer agrees. */
  confirmReplace: (onConfirm: () => void) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/** The customer's cart, shared by Home, the menu screens and checkout. Memory only. Owns the "Start a new cart?" dialog. */
export function CartProvider({ children }: { children: ReactNode }) {
  const state = useCartState();
  const [asking, setAsking] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      confirmReplace: (onConfirm) => {
        pending.current = onConfirm;
        setAsking(true);
      },
    }),
    [state],
  );
  const close = () => {
    pending.current = null;
    setAsking(false);
  };

  return (
    <CartContext.Provider value={value}>
      {children}
      <ReplaceCartDialog
        storeName={asking ? (state.store?.name ?? '') : null}
        onCancel={close}
        onConfirm={() => {
          const confirm = pending.current;
          close();
          confirm?.();
        }}
      />
    </CartContext.Provider>
  );
}

export function useCart() {
  const cart = useContext(CartContext);
  if (!cart) throw new Error('useCart needs a CartProvider');
  return cart;
}
