import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ErrorText } from '@/components/error-text';
import { FaceCamera, type FaceCheck } from '@/components/driver/face-camera';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useDriverVerification, useSaveVerificationNotes, useUploadVerificationPhoto, type VerificationPhoto } from '@/hooks/queries';
import { apiUrl, authHeaders } from '@/lib/api';

/** Green "Verified" pill; shown once a developer has checked the driver's documents. */
export function VerifiedBadge() {
  return (
    <View style={styles.badge}>
      <ThemedText type="smallBold" style={styles.badgeText}>
        ✓ Verified
      </ThemedText>
    </View>
  );
}

/** Face and license photos plus the license plate, for a developer to verify. */
export function DriverVerification() {
  const verification = useDriverVerification();
  const upload = useUploadVerificationPhoto();
  const saveNotes = useSaveVerificationNotes();
  const [plate, setPlate] = useState<string | null>(null);
  // Bumped after each upload so the photo reloads instead of showing the cached one.
  const [version, setVersion] = useState(0);
  const [faceCamera, setFaceCamera] = useState(false);

  const v = verification.data;
  if (!v) return verification.isPending ? <ActivityIndicator /> : <ErrorText error={verification.error} />;
  const plateText = plate ?? v.notes;

  const send = (kind: VerificationPhoto, uri: string, type: string, faceCheck?: FaceCheck) =>
    upload.mutate({ kind, uri, type, faceCheck }, { onSuccess: () => setVersion((n) => n + 1) });

  /** The face goes through FaceCamera's live check; the license uses the plain camera. */
  const pick = async (kind: VerificationPhoto) => {
    if (kind === 'face') {
      setFaceCamera(true);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, cameraType: ImagePicker.CameraType.back });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    send(kind, asset.uri, asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg');
  };

  const photo = (kind: VerificationPhoto, label: string, has: boolean) => (
    <View style={styles.photoBlock}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {has && (
        <Image
          source={{ uri: apiUrl(`/drivers/me/verification/photo/${kind}?v=${version}`), headers: authHeaders() }}
          style={kind === 'face' ? styles.face : styles.license}
          contentFit="cover"
        />
      )}
      {!v.verified && (
        <Button
          title={has ? `Retake ${label.toLowerCase()} photo` : `Take ${label.toLowerCase()} photo`}
          variant="secondary"
          loading={upload.isPending && upload.variables?.kind === kind}
          disabled={upload.isPending}
          onPress={() => pick(kind)}
        />
      )}
    </View>
  );

  return (
    <Card>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold">Driver verification</ThemedText>
        {v.verified && <VerifiedBadge />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {v.verified
          ? 'Your documents are verified and locked. Contact support to change them.'
          : 'Add your photos and license plate. We will review them and mark you verified.'}
      </ThemedText>
      {photo('face', 'Face', v.has_face)}
      {!v.verified && v.face_check === 'skipped' && (
        <ThemedText type="small" themeColor="textSecondary">
          Your face photo skipped the face check, so it will be reviewed by hand. Retake it with the check to speed things up.
        </ThemedText>
      )}
      {photo('id', "Driver's License ID", v.has_id)}
      {v.verified ? (
        <ThemedText type="small">License Plate: {v.notes || 'not provided'}</ThemedText>
      ) : (
        <>
          <TextField label="License Plate" value={plateText} onChangeText={setPlate} autoCapitalize="characters" maxLength={200} />
          <Button
            title="Save license plate"
            disabled={plateText.trim() === v.notes}
            loading={saveNotes.isPending}
            onPress={() => saveNotes.mutate(plateText, { onSuccess: () => setPlate(null) })}
          />
        </>
      )}
      <ErrorText error={upload.error ?? saveNotes.error} />
      <FaceCamera
        visible={faceCamera}
        onClose={() => setFaceCamera(false)}
        onCapture={(uri, check) => {
          setFaceCamera(false);
          send('face', uri, 'image/jpeg', check);
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  badge: { backgroundColor: Brand.success, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  badgeText: { color: '#fff' },
  photoBlock: { gap: Spacing.two },
  face: { width: 120, height: 120, borderRadius: 60 },
  license: { width: '100%', aspectRatio: 1.6, borderRadius: 12 },
});
