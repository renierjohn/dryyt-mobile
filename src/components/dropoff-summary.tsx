import { Image, type ImageSource } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { PhotoViewer } from '@/components/photo-viewer';
import { StoreLogo } from '@/components/store-logo';
import { ThemedText } from '@/components/themed-text';
import { VehicleRow } from '@/components/vehicle-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiUrl, authHeaders } from '@/lib/api';
import { dateTime, peso } from '@/lib/format';
import type { Dropoff } from '@/lib/types';

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText type={bold ? 'smallBold' : 'small'}>{label}</ThemedText>
      <ThemedText type={bold ? 'smallBold' : 'small'}>{value}</ThemedText>
    </View>
  );
}

/** Fees shown depend on who is looking: the API omits delivery/service fee for customers. */
export function DropoffSummary({ dropoff: d }: { dropoff: Dropoff }) {
  const theme = useTheme();
  const [viewing, setViewing] = useState<ImageSource | null>(null);
  const split = d.service_fee !== undefined;
  const proof = { uri: apiUrl(`/dropoffs/${d.id}/proof`), headers: authHeaders() };
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {dateTime(d.created_at)}
      </ThemedText>
      <View style={styles.store}>
        <StoreLogo uri={d.store_logo} size={24} testID="dropoff-summary-store-logo" />
        <ThemedText type="smallBold" style={styles.grow}>
          {d.store_name}
        </ThemedText>
      </View>
      <VehicleRow code={d.vehicle_type} />
      {d.weight_kg !== null && <Row label="Weight" value={`${d.weight_kg} kg`} />}
      {d.delivery_fee !== undefined && <Row label="Delivery fee" value={peso(d.delivery_fee)} />}
      {d.service_fee !== undefined && <Row label="Service fee" value={peso(d.service_fee)} />}
      {/* After the split (owner, driver) it's the sum; the customer only ever sees this one fee. */}
      {split && <View testID="total-delivery-fee-separator" style={[styles.separator, { backgroundColor: theme.border }]} />}
      <Row label={split ? 'Total Delivery fee' : 'Delivery fee'} value={peso(d.total_delivery_fee)} />
      {d.laundry_fee !== null && <Row label="Laundry fee" value={peso(d.laundry_fee)} />}
      {d.laundry_fee !== null && <Row label="Total" value={peso(d.total_delivery_fee + d.laundry_fee)} bold />}
      {d.drop_notes ? <ThemedText type="small">{d.drop_notes}</ThemedText> : null}
      {d.has_proof && (
        <Pressable accessibilityLabel="View proof photo" onPress={() => setViewing(proof)}>
          <Image source={proof} style={styles.photo} contentFit="cover" />
        </Pressable>
      )}
      <PhotoViewer source={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  store: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth * 2, marginVertical: Spacing.one },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
});
