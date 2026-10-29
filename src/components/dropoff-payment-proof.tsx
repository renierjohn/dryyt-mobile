import { Image, type ImageSource } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Card } from '@/components/card';
import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { apiUrl, authHeaders } from '@/lib/api';
import type { Dropoff } from '@/lib/types';

/** The customer's proof of payment for a drop off (reference number and/or photo, tap to zoom); nothing until they send one. */
export function DropoffPaymentProof({ dropoff: d, title }: { dropoff: Dropoff; title: string }) {
  const [viewing, setViewing] = useState<ImageSource | null>(null);
  if (d.payment_ref === '' && !d.has_payment_photo) return null;
  const photo = { uri: apiUrl(`/dropoffs/${d.id}/payment-photo`), headers: authHeaders() };
  return (
    <Card>
      <ThemedText type="smallBold">{title}</ThemedText>
      {d.payment_ref !== '' && <ThemedText type="small">Reference number: {d.payment_ref}</ThemedText>}
      {d.has_payment_photo && (
        <Pressable accessibilityLabel="View proof of payment" onPress={() => setViewing(photo)}>
          <Image testID="dropoff-payment-photo" source={photo} style={styles.photo} contentFit="contain" />
        </Pressable>
      )}
      <PhotoViewer source={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 280, borderRadius: 12 },
});
