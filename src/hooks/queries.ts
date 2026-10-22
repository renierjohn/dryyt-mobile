import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback } from 'react';

import { PICKUP_ENABLED } from '@/constants/features';
import { useAuth } from '@/hooks/use-auth';

import { api, uploadImage } from '@/lib/api';
import { roadRoute } from '@/lib/road-route';
import { loadOnline, saveOnline } from '@/lib/session-storage';
import { shrinkImage } from '@/lib/shrink-image';
import type { DriverMe, DriverVerification, Dropoff, LatLng, MenuItem, Order, OrderDetail, OrderType, OwnerAppFee, OwnerAppFeePayment, Payout, PickupPayout, PopularItem, Store, StoreType, StoreWithMenu } from '@/lib/types';

const POLL_MS = 5000;
/** Fallback poll for screens that also get live updates over a socket. */
const LIVE_POLL_MS = 30_000;

/** Poll only while the screen is on top: tab screens stay mounted when you leave them. */
function usePoll(ms: number = POLL_MS) {
  return useIsFocused() ? ms : false;
}

/** On-demand owner lists load at most once per this long, however often the screen is focused or pulled. */
export const OWNER_MIN_GAP_MS = 5_000;

/**
 * Query options for screens that load on demand, without polling: the query listens only while its screen is focused,
 * so it loads on each visit (and on return to the app while on it), unless it loaded under OWNER_MIN_GAP_MS ago.
 */
const useLoadOnFocus = () => ({ subscribed: useIsFocused(), staleTime: OWNER_MIN_GAP_MS });

type Loadable = { refetch: () => Promise<unknown>; isFetching: boolean; dataUpdatedAt: number; errorUpdatedAt: number };

/** Adds `refresh()` for pull to refresh, skipped within OWNER_MIN_GAP_MS of the last load, and `nextAt` (epoch ms). */
function withMinGap<Q extends Loadable>(query: Q) {
  const nextAt = Math.max(query.dataUpdatedAt, query.errorUpdatedAt) + OWNER_MIN_GAP_MS;
  const refresh = async () => {
    if (query.isFetching || Date.now() < nextAt) return;
    await query.refetch();
  };
  return { ...query, refresh, nextAt };
}

export type NewOrder = {
  type: OrderType;
  store_id: number;
  items: { menu_item_id: number; qty: number }[];
  /** A pinned location prices delivery by road distance; otherwise `customer_address` is required. */
  lat?: number;
  lng?: number;
  customer_address?: string;
  notes?: string;
  /** Food is paid upfront: a reference number, a photo key from useUploadPaymentPhoto, or both. */
  payment_ref?: string;
  payment_photo_key?: string;
  /** From useOrderQuote for the same store and pin, so the server doesn't price the road again. */
  quote_token?: string;
};

/** Proof of payment photo, uploaded before the order is created; resolves to its key. */
export const useUploadPaymentPhoto = () =>
  useMutation({
    mutationFn: async (photo: { uri: string; width: number; height: number }) => {
      const { uri, type } = await shrinkImage(photo.uri, photo.width, photo.height);
      return uploadImage<{ key: string }>('/orders/payment-photo', uri, type).then((r) => r.key);
    },
  });

/** Laundry pickup: sends the proof once the shop has set the laundry fee. */
export function useSendPayment(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { payment_ref: string; payment_photo_key?: string }) =>
      api<{ order: OrderDetail }>(`/orders/${id}/payment`, { body: input }).then((r) => r.order),
    onSuccess: (order) => qc.setQueryData(['order', order.id], order),
  });
}

/** Releases a payment-confirmed order to drivers. */
export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ order: OrderDetail }>(`/orders/${id}/place`, { method: 'POST' }).then((r) => r.order),
    onSuccess: (order) => {
      qc.setQueryData(['order', order.id], order);
      return qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export type DeliveryQuote = { road_km: number; total_delivery_fee: number; token: string };

/** Delivery fee from a pin to the store, priced like a drop off. */
export const useOrderQuote = () =>
  useMutation({
    mutationFn: (input: { store_id: number } & LatLng) => api<{ quote: DeliveryQuote }>('/orders/quote', { body: input }).then((r) => r.quote),
  });

export const useStores = (type: StoreType) =>
  useQuery({
    queryKey: ['stores', type],
    queryFn: () => api<{ stores: Store[] }>(`/stores?type=${type}`).then((r) => r.stores),
  });

export const useStore = (id: number) =>
  useQuery({
    queryKey: ['store', id],
    queryFn: () => api<{ store: StoreWithMenu }>(`/stores/${id}`).then((r) => r.store),
  });

export type PopularFilter = { limit: number; q?: string; category?: string | null };

/**
 * Most-ordered food items across stores (`limit` 1–50), optionally narrowed by name (`q`) and `category`.
 * `categories` is every food category, whatever the filters. Keeps showing the last results while a new filter loads.
 */
export const usePopularMenu = ({ limit, q = '', category = null }: PopularFilter) =>
  useQuery({
    queryKey: ['popular', limit, q, category],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      return api<{ items: PopularItem[]; categories: string[] }>(`/menu/popular?${params}`);
    },
    enabled: PICKUP_ENABLED,
    placeholderData: keepPreviousData,
  });

/** `?before=` for the page after `next` (null = first page). */
const pageParam = (next: string | null) => (next ? `?before=${encodeURIComponent(next)}` : '');

export type HistoryItem = { kind: 'order'; order: Order } | { kind: 'dropoff'; dropoff: Dropoff };
/** `earnings` (centavos): drivers only, on the first page. */
type HistoryPage = { items: HistoryItem[]; next: string | null; earnings?: number };

/** At most one /history request per this long, however often the screen is focused or pulled. */
export const HISTORY_MIN_GAP_MS = 60_000;

/**
 * Orders and drop offs, newest first, 10 per page (`fetchNextPage` for older ones).
 * Customers get everything they placed; drivers get the jobs they finished.
 * No polling: loads when the screen is focused or `refresh()` is called, at most once per HISTORY_MIN_GAP_MS.
 * `nextAt` is when the next load is allowed (epoch ms).
 */
export const useHistory = () => {
  const qc = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ['history'],
    queryFn: ({ pageParam: next }) => api<HistoryPage>(`/history${pageParam(next)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    // Disabled = only explicit refetches; mutations' invalidations just mark it stale for the next allowed load.
    enabled: false,
  });
  const { refetch } = history;

  const refresh = useCallback(async () => {
    const state = qc.getQueryState(['history']);
    const last = Math.max(state?.dataUpdatedAt ?? 0, state?.errorUpdatedAt ?? 0);
    if (state?.fetchStatus === 'fetching' || Date.now() - last < HISTORY_MIN_GAP_MS) return;
    await refetch();
  }, [qc, refetch]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const lastAt = Math.max(history.dataUpdatedAt, history.errorUpdatedAt);
  return { ...history, refresh, nextAt: lastAt + HISTORY_MIN_GAP_MS };
};

/** `isLive()`: the order's socket is pushing changes (from Place order to delivery), so polling is only a slow fallback. */
export const useOrder = (id: number, isLive?: () => boolean) => {
  const poll = usePoll();
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api<{ order: OrderDetail }>(`/orders/${id}`).then((r) => r.order),
    refetchInterval: () => poll && (isLive?.() ? LIVE_POLL_MS : poll),
    enabled: PICKUP_ENABLED,
  });
};

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewOrder) => api<{ order: OrderDetail }>('/orders', { body: input }).then((r) => r.order),
    onSuccess: (order) => {
      qc.setQueryData(['order', order.id], order);
      return qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useCancelOrder(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ order: OrderDetail }>(`/orders/${id}/cancel`, { method: 'POST' }).then((r) => r.order),
    onSuccess: (order) => {
      qc.setQueryData(['order', id], order);
      return qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

/**
 * Pickup jobs, only while the driver is online for pickup. The 'pickups' socket pushes the list (setQueryData);
 * `isLive()`: it's connected, so polling is only a slow fallback.
 */
export const useAvailableJobs = (online: boolean, isLive?: () => boolean) => {
  const poll = usePoll();
  return useQuery({
    queryKey: ['jobs', 'available'],
    queryFn: () => api<{ jobs: Order[] }>('/jobs/available').then((r) => r.jobs),
    refetchInterval: () => poll && (isLive?.() ? LIVE_POLL_MS : poll),
    enabled: PICKUP_ENABLED && online,
  });
};

/**
 * `paused`: the driver is on a drop off, so no pickup job can appear; skip polling.
 * `isLive()`: the order's socket is pushing changes, so polling is only a slow fallback.
 */
export const useActiveJob = (paused = false, isLive?: () => boolean) => {
  const poll = usePoll();
  return useQuery({
    queryKey: ['jobs', 'active'],
    queryFn: () => api<{ job: OrderDetail | null }>('/jobs/active').then((r) => r.job),
    refetchInterval: () => (paused ? false : poll && (isLive?.() ? LIVE_POLL_MS : poll)),
    enabled: PICKUP_ENABLED,
  });
};


export function useAcceptJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ job: OrderDetail }>(`/jobs/${id}/accept`, { method: 'POST' }).then((r) => r.job),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['jobs'] }),
        qc.invalidateQueries({ queryKey: ['history'] }),
        qc.invalidateQueries({ queryKey: ['driver'] }),
      ]),
  });
}

export function useAdvanceJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'picked_up' | 'delivered' }) =>
      api<{ job: OrderDetail }>(`/jobs/${id}/status`, { body: { status } }).then((r) => r.job),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['jobs'] }),
        qc.invalidateQueries({ queryKey: ['history'] }),
        qc.invalidateQueries({ queryKey: ['driver'] }),
      ]),
  });
}

export function useReleaseJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ job: OrderDetail }>(`/jobs/${id}/release`, { method: 'POST' }).then((r) => r.job),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['jobs'] }),
        qc.invalidateQueries({ queryKey: ['history'] }),
        qc.invalidateQueries({ queryKey: ['driver'] }),
      ]),
  });
}

export type NewDropoff = { store_id: number; lat: number; lng: number; address?: string };
export type DropoffAction = { action: 'cancel' | 'driver-cancel' | 'confirm-driver' | 'reject-driver' | 'picked-up' | 'drop' | 'payment'; body?: unknown };

const invalidateDropoffs = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['history'] }),
    qc.invalidateQueries({ queryKey: ['driver'] }),
    qc.invalidateQueries({ queryKey: ['owner'] }),
  ]);

/** `isLive()`: a socket is pushing status changes right now, so polling is only a slow fallback. */
export const useDropoff = (id: number, isLive?: () => boolean) => {
  const poll = usePoll();
  return useQuery({
    queryKey: ['dropoff', id],
    queryFn: () => api<{ dropoff: Dropoff }>(`/dropoffs/${id}`).then((r) => r.dropoff),
    refetchInterval: () => poll && (isLive?.() ? LIVE_POLL_MS : poll),
  });
};


/** Road route between two pins via OpenStreetMap routing; refetches when a pin moves, keeping the old road until the new one arrives. */
export const useRoadRoute = (from: LatLng | null, to: LatLng | null) =>
  useQuery({
    queryKey: ['road-route', from?.lat, from?.lng, to?.lat, to?.lng],
    queryFn: () => roadRoute(from!, to!),
    enabled: from !== null && to !== null,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });

export function useCreateDropoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewDropoff) => api<{ dropoff: Dropoff }>('/dropoffs', { body: input }).then((r) => r.dropoff),
    onSuccess: (dropoff) => {
      qc.setQueryData(['dropoff', dropoff.id], dropoff);
      return invalidateDropoffs(qc);
    },
  });
}

export function useDropoffAction(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: DropoffAction) =>
      api<{ dropoff: Dropoff }>(`/dropoffs/${id}/${action}`, { method: 'POST', body }).then((r) => r.dropoff),
    onSuccess: (dropoff) => {
      qc.setQueryData(['dropoff', id], dropoff);
      return invalidateDropoffs(qc);
    },
  });
}

/** `isLive()`: the trip socket is pushing status changes right now, so polling is only a slow fallback. */
export const useDriverMe = (isLive?: () => boolean) => {
  const poll = usePoll();
  const userId = useUserId();
  return useQuery({
    queryKey: ['driver', 'me'],
    // The server is the source of truth; keep the phone's copy of the switch in step with it.
    queryFn: () =>
      api<DriverMe>('/drivers/me').then((me) => {
        if (userId !== null) void saveOnline(userId, me.driver.online).catch(() => {});
        return me;
      }),
    refetchInterval: () => poll && (isLive?.() ? LIVE_POLL_MS : poll),
  });
};

const useUserId = () => {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.user.id : null;
};

/** The switch as last saved on this phone (null until known), for showing it before /drivers/me answers. */
export const useSavedOnline = () => {
  const userId = useUserId();
  return useQuery({
    queryKey: ['savedOnline', userId],
    queryFn: () => (userId === null ? null : loadOnline(userId).catch(() => null)),
    staleTime: Infinity,
  });
};

export function useSetOnline() {
  const qc = useQueryClient();
  const userId = useUserId();
  return useMutation({
    mutationFn: (online: boolean) => api<{ online: boolean }>('/drivers/me/online', { body: { online } }),
    // Saved only once the server has it, so a failed request leaves the old value on the phone too.
    onSuccess: async ({ online }) => {
      if (userId === null) return;
      qc.setQueryData(['savedOnline', userId], online);
      await saveOnline(userId, online).catch(() => {});
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });
}

/** "Online for Pickup": joins the live pickup job board. */
export function useSetPickupOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (online: boolean) => api<{ online: boolean }>('/drivers/me/pickup-online', { body: { online } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });
}

export type VerificationPhoto = 'face' | 'id';

export const useDriverVerification = () =>
  useQuery({
    queryKey: ['driver', 'verification'],
    queryFn: () => api<{ verification: DriverVerification }>('/drivers/me/verification').then((r) => r.verification),
  });

export function useSaveVerificationNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api<{ verification: DriverVerification }>('/drivers/me/verification', { body: { notes } }),
    onSuccess: (r) => qc.setQueryData(['driver', 'verification'], r.verification),
  });
}

/** Locked (409) once verified, like the photos and plate. */
export function useSaveVehicleType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vehicleType: number) => api<{ verification: DriverVerification }>('/drivers/me/vehicle', { body: { vehicle_type: vehicleType } }),
    onSuccess: (r) => qc.setQueryData(['driver', 'verification'], r.verification),
  });
}

export function useUploadVerificationPhoto() {
  const qc = useQueryClient();
  return useMutation({
    /** `faceCheck` 'skipped' flags a face photo taken without the live face check for a closer review. */
    mutationFn: ({ kind, uri, type, faceCheck }: { kind: VerificationPhoto; uri: string; type: string; faceCheck?: 'passed' | 'skipped' }) =>
      uploadImage<{ verification: DriverVerification }>(
        `/drivers/me/verification/photo/${kind}${faceCheck === 'skipped' ? '?face_check=skipped' : ''}`,
        uri,
        type,
      ),
    onSuccess: (r) => qc.setQueryData(['driver', 'verification'], r.verification),
  });
}

/** Waiting-for-confirmation first, then newest; 10 per page (`fetchNextPage` for more). */
export const useOwnerDropoffs = () => {
  const loadOnFocus = useLoadOnFocus();
  return withMinGap(
    useInfiniteQuery({
      queryKey: ['owner', 'dropoffs'],
      queryFn: ({ pageParam: next }) => api<{ dropoffs: Dropoff[]; next: string | null }>(`/owner/transactions${pageParam(next)}`),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next,
      ...loadOnFocus,
    }),
  );
};

export function useOwnerConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ dropoff: Dropoff }>(`/owner/transactions/${id}/confirm`, { method: 'POST' }).then((r) => r.dropoff),
    onSuccess: (dropoff) => {
      qc.setQueryData(['dropoff', dropoff.id], dropoff);
      return invalidateDropoffs(qc);
    },
  });
}

/** The APP Fee tab's month: amount due per shop and the latest subscription payment. */
export const useOwnerAppFee = () =>
  useQuery({
    queryKey: ['owner', 'app-fee'],
    queryFn: () => api<OwnerAppFee>('/owner/app-fee'),
    ...useLoadOnFocus(),
  });

/** Sends proof of an app fee payment (a reference number and/or a photo); the cpanel fills in the amount. */
export function useSendAppFeeProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ref_number, photo }: { ref_number: string; photo?: { uri: string; width: number; height: number } }) => {
      let key: string | undefined;
      if (photo) {
        const { uri, type } = await shrinkImage(photo.uri, photo.width, photo.height);
        key = (await uploadImage<{ key: string }>('/owner/app-fee/photo', uri, type)).key;
      }
      return api<{ payment: OwnerAppFeePayment }>('/owner/app-fee', { body: { ref_number, photo: key } }).then((r) => r.payment);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner', 'app-fee'] }),
  });
}

/** The app's service fee per week (`week`: the Monday, YYYY-MM-DD, Manila), over all payouts, not just loaded pages. */
export const useServiceFeeWeeks = () =>
  useQuery({
    queryKey: ['owner', 'payouts', 'weeks'],
    queryFn: () => api<{ weeks: { week: string; total: number }[] }>('/owner/service-fee-weeks').then((r) => r.weeks),
    ...useLoadOnFocus(),
  });

/** Newest first; 10 per page (`fetchNextPage` for more). */
export const usePayouts = () => {
  const loadOnFocus = useLoadOnFocus();
  return withMinGap(
    useInfiniteQuery({
      queryKey: ['owner', 'payouts'],
      queryFn: ({ pageParam: next }) => api<{ payouts: Payout[]; next: string | null }>(`/owner/payouts${pageParam(next)}`),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next,
      ...loadOnFocus,
    }),
  );
};

/** Delivered pickups' driver share: not yet paid first, then newest; 10 per page. */
/** Drivers' share of delivered food orders (Orders tab) or laundry pickups (Pickup tab). */
export const usePickupPayouts = (type: StoreType) => {
  const loadOnFocus = useLoadOnFocus();
  return withMinGap(
    useInfiniteQuery({
      queryKey: ['owner', 'pickup-payouts', type],
      queryFn: ({ pageParam: next }) =>
        api<{ payouts: PickupPayout[]; next: string | null }>(`/owner/pickup-payouts?type=${type}${next ? `&before=${encodeURIComponent(next)}` : ''}`),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next,
      ...loadOnFocus,
    }),
  );
};

/** Pickup orders at the owner's shops, newest first. */
/** The owner's food orders (Orders tab) or laundry pickups (Pickups tab). */
export const useOwnerOrders = (type: StoreType) => {
  const loadOnFocus = useLoadOnFocus();
  return withMinGap(
    useInfiniteQuery({
      queryKey: ['owner', 'orders', type],
      queryFn: ({ pageParam: next }) =>
        api<{ orders: OrderDetail[]; next: string | null }>(`/owner/orders?type=${type}${next ? `&before=${encodeURIComponent(next)}` : ''}`),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next,
      ...loadOnFocus,
    }),
  );
};

/** Done Pay: the owner saw the customer's payment. */
export function useConfirmPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ order: OrderDetail }>(`/owner/orders/${id}/confirm-payment`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['owner', 'orders'] }),
  });
}

/** Laundry pickup: the owner sets the laundry fee so the customer can pay. */
export function useSetLaundryFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, laundry_fee }: { id: number; laundry_fee: number }) =>
      api<{ order: OrderDetail }>(`/owner/orders/${id}/laundry-fee`, { body: { laundry_fee } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['owner', 'orders'] }),
  });
}

export function useMarkPayoutPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ payout: Payout }>(`/owner/payouts/${id}/paid`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['owner', 'payouts'] }),
  });
}

export function useMarkPickupPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => api<{ payout: PickupPayout }>(`/owner/orders/${orderId}/driver-paid`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['owner', 'pickup-payouts'] }),
  });
}

export function useBlockDriver() {
  return useMutation({
    mutationFn: (input: { driver_id: number; blocked: boolean; store_id?: number }) => api<{ blocked: boolean }>('/owner/blocks', { body: input }),
  });
}

export type StoreInput = Pick<Store, 'name' | 'type' | 'address' | 'lat' | 'lng' | 'store_logo' | 'store_payment_gateway'>;

export const useOwnerStores = () =>
  useQuery({
    queryKey: ['owner', 'stores'],
    /** `maxstore`: how many shops the owner may run. */
    queryFn: () => api<{ stores: Store[]; maxstore: number }>('/owner/stores'),
  });

/** Customer store lists and the owner's tabs (which need at least one shop) depend on these too. */
const invalidateStores = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([qc.invalidateQueries({ queryKey: ['owner'] }), qc.invalidateQueries({ queryKey: ['stores'] })]);

/** `id` undefined creates a new shop. */
export function useSaveStore(id?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreInput) => api<{ store: Store }>(id ? `/owner/stores/${id}` : '/owner/stores', { body: input }).then((r) => r.store),
    onSuccess: () => invalidateStores(qc),
  });
}

export function useDeleteStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ deleted: boolean }>(`/owner/stores/${id}`, { method: 'DELETE' }),
    onSettled: () => invalidateStores(qc),
  });
}

export type MenuItemInput = Omit<MenuItem, 'id' | 'popularity'>;

/** `itemId` undefined adds a new item. The menu itself is read with `useStore(storeId)`. */
export function useSaveMenuItem(storeId: number, itemId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MenuItemInput) =>
      api<{ item: MenuItem }>(`/owner/stores/${storeId}/menu${itemId ? `/${itemId}` : ''}`, { body: input }).then((r) => r.item),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store', storeId] }),
  });
}

export function useDeleteMenuItem(storeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => api<{ deleted: boolean }>(`/owner/stores/${storeId}/menu/${itemId}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['store', storeId] }),
  });
}

/** `ids`: every item on the menu, in the new order. Shows the new order right away; reloads the menu if the save fails. */
export function useReorderMenu(storeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api<{ menu: MenuItem[] }>(`/owner/stores/${storeId}/menu/order`, { body: { ids } }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ['store', storeId] });
      qc.setQueryData<StoreWithMenu>(['store', storeId], (store) => {
        if (!store) return store;
        const byId = new Map(store.menu.map((m) => [m.id, m]));
        return { ...store, menu: ids.flatMap((id) => byId.get(id) ?? []) };
      });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['store', storeId] }),
  });
}

/** Shrinks a picked photo under 1 MB, then uploads it; the returned URL goes in the item's `image_url` on save. */
export function useUploadMenuImage(storeId: number) {
  return useMutation({
    mutationFn: async (photo: { uri: string; width: number; height: number }) => {
      const { uri, type } = await shrinkImage(photo.uri, photo.width, photo.height);
      return uploadImage<{ image_url: string }>(`/owner/stores/${storeId}/menu/image`, uri, type).then((r) => r.image_url);
    },
  });
}

/** Shrinks a picked logo or payment QR under 1 MB, then uploads it; the returned URL goes on the shop on save. */
export function useUploadStoreImage() {
  return useMutation({
    mutationFn: async (photo: { uri: string; width: number; height: number; target: 'logo' | number }) => {
      const { uri, type } = await shrinkImage(photo.uri, photo.width, photo.height);
      return uploadImage<{ image_url: string }>('/owner/stores/image', uri, type).then((r) => r.image_url);
    },
  });
}
