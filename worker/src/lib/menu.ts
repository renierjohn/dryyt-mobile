import type { MenuItem } from '../types';

const MENU_SELECT = 'SELECT id, name, price, image_url, discount_percent, category, best_seller, popularity FROM store_menu_items';

export type MenuRow = Omit<MenuItem, 'best_seller'> & { best_seller: number };

/** D1 returns booleans as 0/1. Extra columns (e.g. the store's, on the popular list) pass through. */
export const toItem = <T extends MenuRow>({ best_seller, ...rest }: T): Omit<T, 'best_seller'> & { best_seller: boolean } => ({
  ...rest,
  best_seller: best_seller === 1,
});

/** In the owner's order (`sort_order`), then the order added. */
export async function listMenu(db: D1Database, storeId: number) {
  const { results } = await db.prepare(`${MENU_SELECT} WHERE store_id = ? ORDER BY sort_order, id`).bind(storeId).all<MenuRow>();
  return results.map(toItem);
}

export async function getMenuItem(db: D1Database, storeId: number, id: number) {
  const row = await db.prepare(`${MENU_SELECT} WHERE store_id = ? AND id = ?`).bind(storeId, id).first<MenuRow>();
  return row ? toItem(row) : null;
}

/** Public path of an uploaded menu photo; R2 key `menu/<store>/<file>`. */
const IMAGE_PATH = /^\/menu-images\/(\d+)\/([\w-]+\.(?:jpg|png))$/;

export const menuImageUrl = (origin: string, storeId: number, file: string) => `${origin}/menu-images/${storeId}/${file}`;

/** The R2 key behind one of our menu photo URLs, or null for outside URLs (left alone). */
export function menuImageKey(url: string | null | undefined) {
  if (!url) return null;
  try {
    const match = IMAGE_PATH.exec(new URL(url).pathname);
    return match ? `menu/${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}
