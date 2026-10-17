import type { Store } from '../types';

export type StoreRow = Omit<Store, 'store_payment_gateway'> & { store_payment_gateway: string };

/** D1 keeps the payment QR list as JSON text. */
export const toStore = ({ store_payment_gateway, ...rest }: StoreRow): Store => ({
  ...rest,
  store_payment_gateway: JSON.parse(store_payment_gateway),
});

/** Public path of an uploaded logo or payment QR; R2 key `stores/<owner>/<file>`. */
const IMAGE_PATH = /^\/store-images\/(\d+)\/([\w-]+\.(?:jpg|png))$/;

export const storeImageUrl = (origin: string, ownerId: number, file: string) => `${origin}/store-images/${ownerId}/${file}`;

/** The R2 key behind one of our store image URLs, or null for outside URLs (left alone). */
export function storeImageKey(url: string | null | undefined) {
  if (!url) return null;
  try {
    const match = IMAGE_PATH.exec(new URL(url).pathname);
    return match ? `stores/${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

/** Every uploaded image a shop shows: its logo and payment QRs. */
export const storeImageKeys = (store: Pick<Store, 'store_logo' | 'store_payment_gateway'>) =>
  [store.store_logo, ...store.store_payment_gateway.map((p) => p.image_url)].flatMap((url) => storeImageKey(url) ?? []);
