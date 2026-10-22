import { Image } from 'expo-image';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { Icon } from '@/components/icon';
import { NextLoadCountdown } from '@/components/next-load-countdown';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { StoreLogo } from '@/components/store-logo';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useMarkPayoutPaid, useMarkPickupPaid, useOwnerAppFee, usePayouts, usePickupPayouts } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { apiUrl, authHeaders } from '@/lib/api';
import type { OwnerAppFee } from '@/lib/types';
import { d1Time, dayLabel, localDay, peso, timeOfDay } from '@/lib/format';

/** One payout line, from either a drop off or a pickup. */
type Line = {
  key: string;
  id: number;
  driverName: string | null;
  amount: number;
  /** "#12": the order or drop off number (the tab says which), and the shop, for the daily lists. */
  ref: string;
  storeName: string;
  /** The driver's face photo URL, or null to show their initial. */
  face: string | null;
  paidAt: string | null;
  /** D1 UTC text the line was created at, for weekly grouping. */
  at: string;
};

/** Groups lines by local day, newest day first; lines in a day newest first. */
function byDay(lines: Line[]) {
  const days = new Map<string, Line[]>();
  for (const l of [...lines].sort((a, b) => d1Time(b.at) - d1Time(a.at))) days.set(localDay(l.at), [...(days.get(localDay(l.at)) ?? []), l]);
  return [...days.values()];
}

/** Local midnight of the Monday starting the week `d1Utc` falls in. */
function weekStart(d1Utc: string) {
  const date = new Date(d1Time(d1Utc));
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

/** Groups lines by week, newest week first; lines in a week newest first. */
function byWeek(lines: Line[]) {
  const weeks = new Map<number, Line[]>();
  for (const l of lines) weeks.set(weekStart(l.at), [...(weeks.get(weekStart(l.at)) ?? []), l]);
  return [...weeks.entries()]
    .sort(([a], [b]) => b - a)
    .map(([start, group]) => ({ start, lines: group.sort((a, b) => d1Time(b.at) - d1Time(a.at)) }));
}

/** e.g. "Oct 12 – Oct 18, 2026". */
function weekLabel(start: number) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const day = (d: Date, year: boolean) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }) });
  return `${day(new Date(start), false)} – ${day(end, true)}`;
}

const TABS = [
  {
    key: 'fees',
    title: 'APP Fee',
    icon: { ios: 'percent', android: 'percent', web: 'percent' },
    hint: "The app's commission on each drop off.",
  },
  {
    key: 'dropoff',
    title: 'Dropoff',
    icon: { ios: 'tray.and.arrow.down.fill', android: 'move_to_inbox', web: 'move_to_inbox' },
    hint: 'Delivery fees owed to drivers for confirmed drop offs.',
  },
  {
    key: 'pickup',
    title: 'Pickup',
    icon: { ios: 'box.truck.fill', android: 'local_shipping', web: 'local_shipping' },
    hint: "The driver's share of each delivered laundry pickup.",
  },
  {
    key: 'orders',
    title: 'Orders',
    icon: { ios: 'bag.fill', android: 'shopping_bag', web: 'shopping_bag' },
    hint: "The driver's share of each delivered food order.",
  },
] as const;
type TabKey = (typeof TABS)[number]['key'];
/** A swipe starts after this much sideways movement and switches tabs past SWIPE_MIN. */
const SWIPE_START = 20;
const SWIPE_MIN = 60;
const SLIDE_MS = 220;
/** Driver face size in the daily lists. */
const FACE = 24;

/** The section tabs under the Payouts title; the selected one is underlined in the primary colour. */
function PayoutTabs({ tab, onSelect }: { tab: TabKey; onSelect: (tab: TabKey) => void }) {
  const theme = useTheme();
  return (
    <View testID="payout-tabs" style={[styles.tabs, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(t.key)}
              style={[styles.tab, { borderBottomColor: active ? theme.primary : 'transparent' }]}>
              <Icon name={t.icon} size={16} color={active ? theme.primary : theme.textSecondary} />
              <ThemedText type="smallBold" style={{ color: active ? theme.primary : theme.textSecondary }}>
                {t.title}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** "October 2026" for "2026-10". */
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
/** "2026-09-01" (a plain date) as "Sep 1, 2026". */
const dateLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const FEE_TYPE_LABEL = { both: 'Service fee & Subscription', service_fee: 'Service fee', subscription: 'Subscription' } as const;

/**
 * This month's app fee: each shop with what it owes the app (a flat fee, or a percentage of the month's sales), and
 * the owner's latest subscription payment.
 */
function MonthDue({ fee }: { fee: OwnerAppFee }) {
  const theme = useTheme();
  const last = fee.last_payment;
  return (
    <Card>
      <ThemedText style={styles.groupTitleText}>Month of {monthLabel(fee.month)}</ThemedText>
      {fee.stores.map((store) => (
        <View key={store.id} testID={`month-store-${store.id}`} style={[styles.line, { borderTopColor: theme.border }]}>
          <View style={styles.row}>
            <StoreLogo uri={store.store_logo} size={36} testID={`month-store-logo-${store.id}`} />
            <View style={styles.grow}>
              <ThemedText type="smallBold">{store.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {store.fee_type === 2 ? `${store.fee_percentage}% of ${peso(store.sales)} sales` : 'Flat fee'}
              </ThemedText>
            </View>
            <View style={styles.total}>
              <ThemedText type="small" themeColor="textSecondary">
                Amount Due
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                {peso(store.amount_due)}
              </ThemedText>
            </View>
          </View>
        </View>
      ))}
      <View testID="last-payment" style={[styles.line, { borderTopColor: theme.border }]}>
        {last ? (
          <>
            <ThemedText type="small">
              Date paid {dateLabel(last.date_paid)} · {FEE_TYPE_LABEL[last.type]} ·{' '}
              <ThemedText type="smallBold" style={{ color: theme.success }}>
                {peso(last.amount)}
              </ThemedText>
            </ThemedText>
            <ThemedText type="small">
              Payment Method <ThemedText type="smallBold" style={{ color: theme.success }}>{last.payment_type}</ThemedText>
            </ThemedText>
            {last.next_due_date && <ThemedText type="small">Next due: {dateLabel(last.next_due_date)}</ThemedText>}
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No app fee payment recorded yet.
          </ThemedText>
        )}
      </View>
    </Card>
  );
}

/** The driver's face, or their initial when they have no photo. */
function Face({ line }: { line: Line }) {
  const name = line.driverName ?? 'Driver';
  if (!line.face) return <Avatar name={name} size={FACE} />;
  return <Image testID={`driver-face-${line.key}`} source={{ uri: line.face, headers: authHeaders() }} style={styles.face} contentFit="cover" />;
}

/**
 * A card per day: the date and that day's total paid out, then each payout as
 * "# · face · driver · time    amount" over "store    status", with Mark paid while pending.
 */
function dayGroups(section: string, lines: Line[], paying: number | undefined, onPay: (id: number) => void) {
  return byDay(lines).map((day) => (
    <Card key={`${section}-${localDay(day[0].at)}`}>
      <View testID="payout-day" style={styles.row}>
        <ThemedText style={[styles.groupTitleText, styles.grow]}>{dayLabel(day[0].at)}</ThemedText>
        {/* What was actually paid out that day: pending payouts don't count yet. */}
        <PayoutAmount value={day.reduce((sum, l) => sum + (l.paidAt ? l.amount : 0), 0)} />
      </View>
      {day.map((l) => (
        <DayLine key={l.key} line={l}>
          {!l.paidAt && <Button title="Mark paid" variant="secondary" loading={paying === l.id} onPress={() => onPay(l.id)} />}
        </DayLine>
      ))}
    </Card>
  ));
}

function PayoutAmount({ value }: { value: number }) {
  const theme = useTheme();
  return <ThemedText style={[styles.groupTitleText, { color: theme.primary }]}>{peso(value)}</ThemedText>;
}

function DayLine({ line, children }: { line: Line; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={`payout-line-${line.key}`} style={[styles.line, { borderTopColor: theme.border }]}>
      <View style={styles.row}>
        <ThemedText type="smallBold">{line.ref}</ThemedText>
        <Face line={line} />
        <ThemedText type="small" style={styles.grow} numberOfLines={1}>
          {line.driverName ?? 'Driver'} · {timeOfDay(line.at)}
        </ThemedText>
        <ThemedText type="smallBold">{peso(line.amount)}</ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow} numberOfLines={1}>
          {line.storeName}
        </ThemedText>
        <StatusBadge label={line.paidAt ? 'Paid' : 'Pending'} tone={line.paidAt ? 'success' : 'warning'} />
      </View>
      {children}
    </View>
  );
}

export default function Payouts() {
  const theme = useTheme();
  const [tab, setTab] = useState<TabKey>('fees');
  // The page follows the finger; past SWIPE_MIN it slides out, the next tab's page slides in from the other side.
  const index = TABS.findIndex((t) => t.key === tab);
  const offset = useSharedValue(0);
  const { width } = useWindowDimensions();
  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const show = (next: number, from: number) => {
    setTab(TABS[next].key);
    offset.set(from);
    offset.set(withTiming(0, { duration: SLIDE_MS }));
  };
  const select = (key: TabKey) => {
    const next = TABS.findIndex((t) => t.key === key);
    if (next !== index) show(next, next > index ? width : -width);
  };
  // Horizontal only: a mostly vertical drag stays a scroll.
  const swipe = Gesture.Pan()
    .activeOffsetX([-SWIPE_START, SWIPE_START])
    .failOffsetY([-SWIPE_START, SWIPE_START])
    .onUpdate((e) => {
      // No tab past either end: the page only gives a little.
      const edge = (e.translationX > 0 && index === 0) || (e.translationX < 0 && index === TABS.length - 1);
      offset.set(edge ? e.translationX / 4 : e.translationX);
    })
    .onEnd((e) => {
      const by = e.translationX <= -SWIPE_MIN ? 1 : e.translationX >= SWIPE_MIN ? -1 : 0;
      const next = index + by;
      if (by === 0 || next < 0 || next >= TABS.length) {
        offset.set(withTiming(0, { duration: SLIDE_MS }));
        return;
      }
      offset.set(
        withTiming(-by * width, { duration: SLIDE_MS }, (done) => {
          if (done) scheduleOnRN(show, next, by * width);
        }),
      );
    });

  const payouts = usePayouts();
  const appFee = useOwnerAppFee();
  // Laundry pickups and food orders are paid out on their own tabs, like the Pickups and Orders tabs.
  const laundryPickups = usePickupPayouts('laundry');
  const foodOrders = usePickupPayouts('food');
  const pickups = tab === 'orders' ? foodOrders : laundryPickups;
  const markPaid = useMarkPayoutPaid();
  const markPickupPaid = useMarkPickupPaid();
  // The worker already sorts both lists: pending first, then newest.
  const list = payouts.data?.pages.flatMap((p) => p.payouts) ?? [];
  const toLine = (p: (typeof list)[number]): Line => ({
    key: `payout-${p.id}`,
    id: p.id,
    driverName: p.payee_name,
    amount: p.amount,
    ref: `#${p.transaction_id}`,
    storeName: p.store_name ?? '',
    face: p.payee_id && p.payee_has_face ? apiUrl(`/owner/drivers/${p.payee_id}/face?v=${p.payee_photo_version}`) : null,
    paidAt: p.status === 'paid' ? p.paid_at : null,
    at: p.created_at,
  });
  // Service fee lines show the drop off's driver; the payee is the app.
  const serviceFees = list
    .filter((p) => p.payee_type === 'developer')
    .map((p) => ({ ...toLine(p), driverName: p.driver_name, face: null }));
  const drivers = list.filter((p) => p.payee_type === 'driver').map(toLine);
  const pickupLines = (pickups.data?.pages.flatMap((p) => p.payouts) ?? []).map(
    (p): Line => ({
      key: `pickup-${p.id}`,
      id: p.id,
      driverName: p.driver_name,
      amount: p.amount,
      ref: `#${p.id}`,
      storeName: p.store_name,
      face: p.driver_has_face ? apiUrl(`/owner/drivers/${p.driver_id}/face?v=${p.driver_photo_version}`) : null,
      paidAt: p.paid_at,
      at: p.updated_at,
    }),
  );

  const rows: ReactElement[] = [];
  const empty = (key: string, text: string) => (
    <ThemedText key={key} themeColor="textSecondary">
      {text}
    </ThemedText>
  );
  rows.push(
    <ThemedText key="hint" type="small" themeColor="textSecondary">
      {TABS.find((t) => t.key === tab)!.hint}
    </ThemedText>,
  );

  if (tab === 'fees' && appFee.data) rows.push(<MonthDue key="month" fee={appFee.data} />);
  if (tab === 'fees' && payouts.isSuccess) {
    if (serviceFees.length === 0) rows.push(empty('no-fees', 'No service fees yet.'));
    for (const week of byWeek(serviceFees)) {
      rows.push(
        <Card key={`week-${week.start}`}>
          <View testID="fee-week" style={styles.row}>
            <ThemedText type="smallBold" style={styles.grow}>
              {weekLabel(week.start)}
            </ThemedText>
            <PayoutAmount value={week.lines.reduce((sum, l) => sum + l.amount, 0)} />
          </View>
          {week.lines.map((l) => (
            <View key={l.key} testID={`fee-line-${l.key}`} style={[styles.line, styles.row, { borderTopColor: theme.border }]}>
              <ThemedText type="smallBold">{l.ref}</ThemedText>
              <ThemedText type="small" style={styles.grow} numberOfLines={1}>
                {l.driverName ?? 'Driver'}
              </ThemedText>
              <ThemedText type="small">{peso(l.amount)}</ThemedText>
            </View>
          ))}
        </Card>,
      );
    }
  }

  if (tab === 'dropoff' && payouts.isSuccess) {
    if (drivers.length === 0) rows.push(empty('no-dropoffs', 'Nothing to pay yet.'));
    rows.push(...dayGroups('dropoff', drivers, markPaid.isPending ? markPaid.variables : undefined, (id) => markPaid.mutate(id)));
  }

  // Service fees and drop off fees come from the same list, so either tab can load more of it.
  if ((tab === 'fees' || tab === 'dropoff') && payouts.hasNextPage) {
    rows.push(
      <Button key="more-payouts" title="Show More" variant="secondary" loading={payouts.isFetchingNextPage} onPress={() => payouts.fetchNextPage()} />,
    );
  }

  if ((tab === 'pickup' || tab === 'orders') && pickups.isSuccess) {
    if (pickupLines.length === 0) rows.push(empty('no-pickups', 'Nothing to pay yet.'));
    rows.push(...dayGroups(tab, pickupLines, markPickupPaid.isPending ? markPickupPaid.variables : undefined, (id) => markPickupPaid.mutate(id)));
    if (pickups.hasNextPage) {
      rows.push(
        <Button key="more-pickups" title="Show More" variant="secondary" loading={pickups.isFetchingNextPage} onPress={() => pickups.fetchNextPage()} />,
      );
    }
  }

  const top = [
    <ThemedText key="title" type="subtitle">
      Payouts
    </ThemedText>,
    <PayoutTabs key="tabs" tab={tab} onSelect={select} />,
    __DEV__ && <NextLoadCountdown key="countdown" at={Math.max(payouts.nextAt, pickups.nextAt)} label="payouts" />,
    (payouts.isPending || pickups.isPending) && <ActivityIndicator key="loading" />,
    <ErrorText key="error" error={payouts.error ?? pickups.error ?? appFee.error ?? markPaid.error ?? markPickupPaid.error} />,
  ].filter((row): row is ReactElement => Boolean(row));

  return (
    // The tabs stick to the top while the selected section scrolls under them.
    <Screen onRefresh={() => Promise.all([payouts.refresh(), pickups.refresh(), appFee.refetch()])} stickyHeaderIndices={[1]}>
      {top}
      {/* Swipe left or right across the list for the next or previous tab. */}
      <GestureDetector gesture={swipe}>
        <Animated.View testID="payout-pages" style={[styles.page, pageStyle]}>
          {rows}
        </Animated.View>
      </GestureDetector>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabRow: { gap: Spacing.four, paddingHorizontal: Spacing.two },
  tab: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, borderBottomWidth: 2 },
  page: { gap: Spacing.three },
  groupTitleText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  total: { alignItems: 'flex-end', gap: Spacing.half },
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.one },
  face: { width: FACE, height: FACE, borderRadius: FACE / 2 },
});
