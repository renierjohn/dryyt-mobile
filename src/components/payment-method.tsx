import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/category-chips';
import { ErrorText } from '@/components/error-text';
import { OrDivider } from '@/components/or-divider';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSendPayment, useStore, useUploadPaymentPhoto } from '@/hooks/queries';
import { peso } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';

export type PaymentProof = { payment_ref: string; payment_photo_key?: string };

/** Laundry pickup once the shop set the laundry fee, or any order whose proof the shop turned down: pay and send the proof. */
export function LaundryPayment({ order }: { order: OrderDetail }) {
  const send = useSendPayment(order.id);
  return (
    <PaymentMethod
      storeId={order.store_id}
      storeName={order.store_name}
      total={order.items_total + order.total_delivery_fee}
      onSend={(proof) => send.mutate(proof)}
      sending={send.isPending}
      error={send.error}
    />
  );
}

/**
 * The customer picks one of the shop's payment methods, pays `total` to its QR, and sends a reference number or a
 * photo of the payment (`onSend`) for the shop to check. Food sends it with the order; laundry once the fee is set.
 */
export function PaymentMethod({
  storeId,
  storeName,
  total,
  onSend,
  sending,
  error,
}: {
  storeId: number;
  storeName: string;
  total: number;
  onSend: (proof: PaymentProof) => void;
  sending: boolean;
  error: Error | null;
}) {
  const store = useStore(storeId);
  const upload = useUploadPaymentPhoto();
  const [method, setMethod] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState('');
  const [proof, setProof] = useState<{ uri: string; key: string } | null>(null);
  const gateways = store.data?.store_payment_gateway ?? [];
  const chosen = gateways.find((g) => g.label === method) ?? null;

  const pickProof = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    upload.mutate({ uri: asset.uri, width: asset.width, height: asset.height }, { onSuccess: (key) => setProof({ uri: asset.uri, key }) });
  };
  // Either proof is enough: a reference number, or a photo of the payment.
  const hasProof = paymentRef.trim() !== '' || proof !== null;

  return (
    <Card>
      <ThemedText type="smallBold">Payment method</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Pay {peso(total)} to {storeName}, then send your proof of payment.
      </ThemedText>
      {gateways.length > 0 ? (
        <View style={styles.methods}>
          {gateways.map((g) => (
            <Chip key={g.image_url} label={g.label} active={g.label === method} onPress={() => setMethod(g.label)} />
          ))}
        </View>
      ) : (
        store.isSuccess && <ThemedText themeColor="textSecondary">This shop hasn&apos;t added a payment method yet.</ThemedText>
      )}
      <ErrorText error={store.error} />
      {chosen && (
        <>
          <View style={styles.qr}>
            <Image testID="payment-qr" source={{ uri: chosen.image_url }} style={styles.qrImage} contentFit="contain" />
            <ThemedText type="smallBold">{chosen.label}</ThemedText>
          </View>
          <TextField label="Reference number" value={paymentRef} onChangeText={setPaymentRef} autoCapitalize="characters" autoCorrect={false} />
          <OrDivider />
          {proof && <Image testID="payment-proof" source={{ uri: proof.uri }} style={styles.proof} contentFit="cover" />}
          <Button
            title={proof ? 'Change photo' : 'Upload proof of payment'}
            variant="secondary"
            icon={{ ios: 'photo', android: 'image', web: 'image' }}
            onPress={pickProof}
            loading={upload.isPending}
          />
          <ThemedText type="small" themeColor="textSecondary">
            A reference number or a photo is enough.
          </ThemedText>
          <ErrorText error={upload.error ?? error} />
          <Button
            title="Send proof of payment"
            onPress={() => onSend({ payment_ref: paymentRef.trim(), payment_photo_key: proof?.key })}
            loading={sending}
            disabled={!hasProof || upload.isPending}
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  qr: { alignItems: 'center', gap: Spacing.one },
  qrImage: { width: 200, height: 200, borderRadius: 12 },
  proof: { width: '100%', height: 200, borderRadius: 12 },
});
