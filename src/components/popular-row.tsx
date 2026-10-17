import { MenuItemRow } from '@/components/menu-item-row';
import type { PopularItem } from '@/lib/types';

/** Home's "Popular now": the top items across stores, ending in "More" (See all); nothing when there are none. */
export function PopularRow({ items, onSeeAll, onOpen }: { items: PopularItem[] | undefined; onSeeAll: () => void; onOpen: (item: PopularItem) => void }) {
  return <MenuItemRow title="Popular now" items={items} onOpen={onOpen} onMore={onSeeAll} storeNameOf={(item) => item.store_name} />;
}
