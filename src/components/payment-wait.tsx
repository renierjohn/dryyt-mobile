import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { d1Time } from '@/lib/format';

/** Matches the worker's PAYMENT_AUTO_CONFIRM_MS: with no Done Pay by then, the payment is accepted for the shop. */
const PAYMENT_CONFIRM_SECONDS = 11 * 60;

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** An order in awaiting_payment, since `since` (its updated_at): a spinner and the time left before it confirms itself. */
export function PaymentWait({ since }: { since: string }) {
  const end = d1Time(since) + PAYMENT_CONFIRM_SECONDS * 1000;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));

  return (
    <View style={styles.row}>
      <ActivityIndicator />
      <View style={styles.grow}>
        <ThemedText>Waiting for Payment Confirmation</ThemedText>
        {!Number.isNaN(end) && (
          <ThemedText testID="payment-countdown" type="small" themeColor="textSecondary">
            {left > 0 ? `Confirmed automatically in ${mmss(left)}` : 'Confirming your payment…'}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 },
});
