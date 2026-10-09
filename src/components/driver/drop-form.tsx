import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { api, uploadImage } from '@/lib/api';
import type { Dropoff } from '@/lib/types';

export function DropForm({ job }: { job: Dropoff }) {
  const qc = useQueryClient();
  const [weight, setWeight] = useState('');
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; type: string } | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (!photo) throw new Error('Take a photo of the laundry at the shop.');
      const { key } = await uploadImage<{ key: string }>(`/dropoffs/${job.id}/proof-upload`, photo.uri, photo.type);
      return api(`/dropoffs/${job.id}/drop`, {
        body: { weight_kg: Number(weight), laundry_fee: Math.round(Number(fee) * 100), notes, proof_photo_key: key },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5 });
    const asset = result.assets?.[0];
    if (!result.canceled && asset) setPhoto({ uri: asset.uri, type: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
  };

  const valid = Number(weight) > 0 && fee.trim() !== '' && Number(fee) >= 0 && photo !== null;

  return (
    <Card>
      <ThemedText type="smallBold">Drop-off details</ThemedText>
      <TextField label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <TextField label="Laundry fee from the shop (₱)" value={fee} onChangeText={setFee} keyboardType="decimal-pad" />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
      {photo && <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />}
      <Button title={photo ? 'Retake photo' : 'Take proof photo'} variant="secondary" onPress={takePhoto} />
      <ErrorText error={submit.error} />
      <Button title="Done" disabled={!valid} loading={submit.isPending} onPress={() => submit.mutate()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
});
