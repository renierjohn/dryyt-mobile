import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
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
  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {dateTime(d.created_at)}
      </ThemedText>
      <ThemedText type="smallBold">{d.store_name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        From {d.customer_address}
      </ThemedText>
      {d.weight_kg !== null && <Row label="Weight" value={`${d.weight_kg} kg`} />}
      {d.delivery_fee !== undefined && <Row label="Delivery fee" value={peso(d.delivery_fee)} />}
      {d.service_fee !== undefined && <Row label="Service fee" value={peso(d.service_fee)} />}
      <Row label="Delivery fee" value={peso(d.total_delivery_fee)} />
      {d.laundry_fee !== null && <Row label="Laundry fee" value={peso(d.laundry_fee)} />}
      {d.laundry_fee !== null && <Row label="Total to pay the shop" value={peso(d.total_delivery_fee + d.laundry_fee)} bold />}
      {d.drop_notes ? <ThemedText type="small">{d.drop_notes}</ThemedText> : null}
      {d.has_proof && (
        <Image source={{ uri: apiUrl(`/dropoffs/${d.id}/proof`), headers: authHeaders() }} style={styles.photo} contentFit="cover" />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
});
