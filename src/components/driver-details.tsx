import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { VerifiedBadge } from '@/components/driver/driver-verification';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { apiUrl, authHeaders } from '@/lib/api';
import type { Dropoff } from '@/lib/types';

type Driver = Pick<Dropoff, 'driver_name' | 'driver_phone' | 'driver_has_face' | 'driver_has_id' | 'driver_photo_version' | 'driver_notes' | 'driver_verified'>;

/**
 * The assigned driver as the customer sees them: face, license, plate and badge. `photoPath` is the drop off's or
 * order's driver-photo route, e.g. `/orders/7/driver-photo`.
 */
export function DriverDetails({ driver: d, photoPath }: { driver: Driver; photoPath: string }) {
  const photo = (kind: 'face' | 'id') => ({ uri: apiUrl(`${photoPath}/${kind}?v=${d.driver_photo_version}`), headers: authHeaders() });
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {d.driver_has_face && <Image source={photo('face')} style={styles.face} contentFit="cover" />}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText type="smallBold">{d.driver_name}</ThemedText>
            {d.driver_verified && <VerifiedBadge />}
          </View>
          <ThemedText type="small">{d.driver_phone}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            License plate: {d.driver_notes || 'not provided'}
          </ThemedText>
        </View>
      </View>
      {d.driver_has_id ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Driver&apos;s License ID
          </ThemedText>
          <Image source={photo('id')} style={styles.license} contentFit="cover" />
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No license photo yet.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  info: { flex: 1, gap: Spacing.half },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  face: { width: 72, height: 72, borderRadius: 36 },
  license: { width: '100%', aspectRatio: 1.6, borderRadius: 12 },
});
