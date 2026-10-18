import type { ReactElement, ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { NextLoadCountdown } from '@/components/next-load-countdown';
import { Screen } from '@/components/screen';
import { StatusBadge } from '@/components/status-badge';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useMarkPayoutPaid, useMarkPickupPaid, usePayouts, usePickupPayouts } from '@/hooks/queries';
import { useTheme } from '@/hooks/use-theme';
import { d1Time, dateTime, peso } from '@/lib/format';

/** One payout line, from either a drop off or a pickup. */
type Line = {
  key: string;
  id: number;
  driverId: number | null;
  driverName: string | null;
  amount: number;
  label: string;
  paidAt: string | null;
  /** D1 UTC text the line was created at, for weekly grouping. */
  at: string;
};

/** Groups lines by driver, keeping the order the worker sorted them in. */
function byDriver(lines: Line[]) {
  const groups = new Map<number | null, Line[]>();
  for (const l of lines) groups.set(l.driverId, [...(groups.get(l.driverId) ?? []), l]);
  return [...groups.values()];
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

const pendingTotal = (lines: Line[]) => lines.reduce((sum, l) => sum + (l.paidAt ? 0 : l.amount), 0);

function GroupTitle({ title, hint }: { title: string; hint: string }) {
  const theme = useTheme();
  return (
    <View testID="payout-section" style={[styles.groupTitle, { backgroundColor: theme.background }]}>
      <ThemedText style={styles.groupTitleText}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {hint}
      </ThemedText>
    </View>
  );
}

/** Card header: what is still owed, highlighted in the primary colour. */
function CardHeader({ name, lines }: { name: string; lines: Line[] }) {
  const theme = useTheme();
  const pending = pendingTotal(lines);
  return (
    <View style={styles.row}>
      <Avatar name={name} size={36} />
      <View style={styles.grow}>
        <ThemedText type="smallBold">{name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {lines.length} {lines.length === 1 ? 'payout' : 'payouts'}
        </ThemedText>
      </View>
      <View style={styles.total}>
        <ThemedText type="smallBold" style={{ color: pending ? theme.primary : theme.textSecondary }}>
          {peso(pending)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          pending
        </ThemedText>
      </View>
    </View>
  );
}

function LineRow({ line, children }: { line: Line; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.line, { borderTopColor: theme.border }]}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <ThemedText type="small">{line.label}</ThemedText>
          {line.paidAt && (
            <ThemedText type="small" themeColor="textSecondary">
              Paid {dateTime(line.paidAt)}
            </ThemedText>
          )}
        </View>
        <View style={styles.total}>
          <ThemedText type="smallBold">{peso(line.amount)}</ThemedText>
          <StatusBadge label={line.paidAt ? 'Paid' : 'Pending'} tone={line.paidAt ? 'success' : 'warning'} />
        </View>
      </View>
      {children}
    </View>
  );
}

/** A card per driver (keys start with `section`); each pending line gets its own Mark paid. Returns rows, not one element, for the sticky titles. */
function driverGroups(section: string, lines: Line[], paying: number | undefined, onPay: (id: number) => void) {
  return byDriver(lines).map((group) => (
    <Card key={`${section}-${group[0].driverId ?? 'none'}`}>
      <CardHeader name={group[0].driverName ?? 'Driver'} lines={group} />
      {group.map((l) => (
        <LineRow key={l.key} line={l}>
          {!l.paidAt && <Button title="Mark paid" variant="secondary" loading={paying === l.id} onPress={() => onPay(l.id)} />}
        </LineRow>
      ))}
    </Card>
  ));
}

export default function Payouts() {
  const theme = useTheme();
  const payouts = usePayouts();
  const pickups = usePickupPayouts();
  const markPaid = useMarkPayoutPaid();
  const markPickupPaid = useMarkPickupPaid();
  // The worker already sorts both lists: pending first, then newest.
  const list = payouts.data?.pages.flatMap((p) => p.payouts) ?? [];
  const toLine = (p: (typeof list)[number]): Line => ({
    key: `payout-${p.id}`,
    id: p.id,
    driverId: p.payee_id,
    driverName: p.payee_name,
    amount: p.amount,
    label: `${p.store_name} · Drop off #${p.transaction_id}`,
    paidAt: p.status === 'paid' ? p.paid_at : null,
    at: p.created_at,
  });
  const serviceFees = list.filter((p) => p.payee_type === 'developer').map(toLine);
  const drivers = list.filter((p) => p.payee_type === 'driver').map(toLine);
  const pickupLines = (pickups.data?.pages.flatMap((p) => p.payouts) ?? []).map(
    (p): Line => ({
      key: `pickup-${p.id}`,
      id: p.id,
      driverId: p.driver_id,
      driverName: p.driver_name,
      amount: p.amount,
      label: `${p.store_name} · Pickup #${p.id}`,
      paidAt: p.paid_at,
      at: p.updated_at,
    }),
  );

  // Rows are direct children of the scroll view so each section title can stick to the top until the next one pushes it off.
  const rows: ReactElement[] = [];
  const sticky: number[] = [];
  const section = (title: string, hint: string) => {
    sticky.push(rows.length);
    rows.push(<GroupTitle key={title} title={title} hint={hint} />);
  };
  const empty = (key: string, text: string) => (
    <ThemedText key={key} themeColor="textSecondary">
      {text}
    </ThemedText>
  );

  if (payouts.isSuccess) {
    section('App service fee', "The app's commission on each drop off.");
    if (serviceFees.length === 0) rows.push(empty('no-fees', 'No service fees yet.'));
    for (const week of byWeek(serviceFees)) {
      rows.push(
        <Card key={`week-${week.start}`}>
          <View style={styles.row}>
            <ThemedText style={[styles.groupTitleText, styles.grow, { color: theme.primary }]}>
              {peso(week.lines.reduce((sum, l) => sum + l.amount, 0))}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {weekLabel(week.start)}
            </ThemedText>
          </View>
          {week.lines.map((l) => (
            <LineRow key={l.key} line={l} />
          ))}
        </Card>,
      );
    }

    section('Drivers · Drop off Delivery Fee', 'Delivery fees owed for confirmed drop offs.');
    if (drivers.length === 0) rows.push(empty('no-dropoffs', 'Nothing to pay yet.'));
    rows.push(...driverGroups('dropoff', drivers, markPaid.isPending ? markPaid.variables : undefined, (id) => markPaid.mutate(id)));
    if (payouts.hasNextPage) {
      rows.push(
        <Button key="more-payouts" title="Show More" variant="secondary" loading={payouts.isFetchingNextPage} onPress={() => payouts.fetchNextPage()} />,
      );
    }
  }

  if (pickups.isSuccess) {
    section('Drivers · Pickup Delivery Fee', "The driver's share of each delivered pickup.");
    if (pickupLines.length === 0) rows.push(empty('no-pickups', 'Nothing to pay yet.'));
    rows.push(...driverGroups('pickup', pickupLines, markPickupPaid.isPending ? markPickupPaid.variables : undefined, (id) => markPickupPaid.mutate(id)));
    if (pickups.hasNextPage) {
      rows.push(
        <Button key="more-pickups" title="Show More" variant="secondary" loading={pickups.isFetchingNextPage} onPress={() => pickups.fetchNextPage()} />,
      );
    }
  }

  // The fixed rows above the list, null ones dropped so `sticky` indexes line up with the scroll view's children.
  const top = [
    <ThemedText key="title" type="subtitle">
      Payouts
    </ThemedText>,
    __DEV__ && <NextLoadCountdown key="countdown" at={Math.max(payouts.nextAt, pickups.nextAt)} label="payouts" />,
    (payouts.isPending || pickups.isPending) && <ActivityIndicator key="loading" />,
    <ErrorText key="error" error={payouts.error ?? pickups.error ?? markPaid.error ?? markPickupPaid.error} />,
  ].filter((row): row is ReactElement => Boolean(row));

  return (
    <Screen onRefresh={() => Promise.all([payouts.refresh(), pickups.refresh()])} stickyHeaderIndices={sticky.map((i) => i + top.length)}>
      {top}
      {rows}
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupTitle: { paddingTop: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.half },
  groupTitleText: { fontSize: 20, lineHeight: 28, fontWeight: 700 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  total: { alignItems: 'flex-end', gap: Spacing.half },
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.two },
});
