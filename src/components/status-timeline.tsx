import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { STATUS_LABEL } from '@/lib/format';
import type { OrderStatus } from '@/lib/types';

const STEPS: OrderStatus[] = ['pending', 'accepted', 'picked_up', 'delivered'];

export function StatusTimeline({ status }: { status: OrderStatus }) {
  const theme = useTheme();

  if (status === 'cancelled') {
    return (
      <ThemedText type="smallBold" style={{ color: theme.danger }}>
        {STATUS_LABEL.cancelled}
      </ThemedText>
    );
  }

  const current = STEPS.indexOf(status);
  return (
    <View style={styles.list}>
      {STEPS.map((step, i) => (
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
