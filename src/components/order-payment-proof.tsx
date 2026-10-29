import { Image, type ImageSource } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Card } from '@/components/card';
import { PhotoViewer } from '@/components/photo-viewer';
import { ThemedText } from '@/components/themed-text';
import { apiUrl, authHeaders } from '@/lib/api';
import type { Order } from '@/lib/types';

/** The customer's proof of payment for a pickup order (reference number and/or photo, tap to zoom); nothing until they send one. */
export function OrderPaymentProof({ order: o }: { order: Order }) {
  const [viewing, setViewing] = useState<ImageSource | null>(null);
  if (!o.payment_ref && !o.payment_photo_key) return null;
  const photo = { uri: apiUrl(`/orders/${o.id}/payment-photo`), headers: authHeaders() };
  return (
    <Card>
      <ThemedText type="smallBold">Proof of payment</ThemedText>
      {o.payment_ref ? <ThemedText type="small">Reference number: {o.payment_ref}</ThemedText> : null}
      {o.payment_photo_key && (
        <Pressable accessibilityLabel="View proof of payment" onPress={() => setViewing(photo)}>
          <Image testID="order-payment-photo" source={photo} style={styles.photo} contentFit="contain" />
        </Pressable>
      )}
      <PhotoViewer source={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 280, borderRadius: 12 },
});
