import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { STATUS_LABEL } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';

const STEPS: OrderStatus[] = ['pending', 'accepted', 'picked_up', 'delivered'];
const PAID_STEPS: OrderStatus[] = ['awaiting_payment', 'payment_confirmed', ...STEPS];
const LAUNDRY_STEPS: OrderStatus[] = ['awaiting_fee', 'to_pay', ...PAID_STEPS];

/** `paid`: paid upfront (food), so the payment steps come first; `laundry`: the shop sets the laundry fee before that. */
export function StatusTimeline({ status, paid = false, laundry = false }: { status: OrderStatus; paid?: boolean; laundry?: boolean }) {
  const theme = useTheme();

  if (status === 'cancelled') {
    return (
      <ThemedText type="smallBold" style={{ color: theme.danger }}>
        {STATUS_LABEL.cancelled}
      </ThemedText>
    );
  }

  // A food order whose proof the shop turned down is back at to_pay, before the payment steps.
  const steps = laundry ? LAUNDRY_STEPS : paid ? (status === 'to_pay' ? (['to_pay', ...PAID_STEPS] satisfies OrderStatus[]) : PAID_STEPS) : STEPS;
  const current = steps.indexOf(status);
  return (
    <View style={styles.list}>
      {steps.map((step, i) => (
        <View key={step} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: i < current ? theme.success : i === current ? theme.primary : theme.backgroundSelected }]} />
          <ThemedText type={i === current ? 'smallBold' : 'small'} themeColor={i <= current ? 'text' : 'textSecondary'}>
            {STATUS_LABEL[step]}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
