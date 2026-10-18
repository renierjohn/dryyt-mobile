import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, View, type LayoutRectangle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { faceProblem, type FaceBounds } from '@/lib/face-check';
import { NativeFaceCamera, type FaceBox, type NativeFaceCameraRef } from '../../../modules/face-camera';

/** The face must stay valid this long before the shutter unlocks, so a passing glance doesn't count. */
const STEADY_MS = 600;

export type FaceCheck = 'passed' | 'skipped';

/** Without a valid face for this long, the driver may take the photo without the check. */
const FALLBACK_MS = 20_000;

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * A JPEG as a file:// URI. `check` is 'passed' for a photo of one valid face, or 'skipped' when the live check
   * couldn't run on this phone and the driver took it anyway (it then waits for a closer manual review).
   */
  onCapture: (uri: string, check: FaceCheck) => void;
};

/** Front camera that draws a box around the face and only lets the driver shoot a clear, front-facing one. */
export function FaceCamera({ visible, onClose, onCapture }: Props) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible && <FaceCameraBody onClose={onClose} onCapture={onCapture} />}
    </Modal>
  );
}

function FaceCameraBody({ onClose, onCapture }: Omit<Props, 'visible'>) {
  const [permission, requestPermission] = ImagePicker.useCameraPermissions();
  const camera = useRef<NativeFaceCameraRef>(null);

  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const [face, setFace] = useState<FaceBounds | null>(null);
  const [problem, setProblem] = useState<string | null>('Place your face inside the frame');
  const [validSince, setValidSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The check hasn't passed after FALLBACK_MS, or the camera can't detect faces: offer to skip it. */
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStuck(true), FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  // Ticks while the face is valid so the shutter unlocks once it has been steady for STEADY_MS.
  useEffect(() => {
    if (validSince === null) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [validSince]);

  /** Boxes come normalized to the view; the native side already throttles them. */
  const onFaces = (boxes: FaceBox[]) => {
    if (!layout) return;
    const at = Date.now();
    const faces = boxes.map((b) => ({ x: b.x * layout.width, y: b.y * layout.height, width: b.width * layout.width, height: b.height * layout.height }));
    const next = faceProblem(faces, layout);
    setFace(faces.length === 1 ? faces[0] : null);
    setProblem(next);
    setValidSince((since) => (next ? null : (since ?? at)));
    setNow(at);
  };

  const ready = problem === null && validSince !== null && now - validSince >= STEADY_MS;

  /** `skipCheck`: the fallback, taken without the face check. */
  const capture = async (skipCheck = false) => {
    if ((!ready && !skipCheck) || !camera.current) return;
    setCapturing(true);
    setError(null);
    try {
      const uri = await camera.current.takePhoto();
      onCapture(uri, skipCheck ? 'skipped' : 'passed');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCapturing(false);
    }
  };

  if (permission && !permission.granted) {
    return (
      <SafeAreaView style={[styles.fill, styles.center]}>
        <ThemedText style={styles.light}>Allow camera access to take your face photo.</ThemedText>
        {permission.canAskAgain && <Button title="Allow camera" onPress={requestPermission} />}
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </SafeAreaView>
    );
  }
  if (Platform.OS !== 'android') {
    // The phone's own camera app, without the face check (the native face camera is Android-only).
    const usePhoneCamera = async () => {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, cameraType: ImagePicker.CameraType.front });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) onCapture(asset.uri, 'skipped');
    };
    return (
      <SafeAreaView style={[styles.fill, styles.center]}>
        <ThemedText style={styles.light}>The face check can&apos;t use this phone&apos;s camera.</ThemedText>
        <Button title="Use phone camera instead" onPress={usePhoneCamera} />
        <ThemedText type="small" style={styles.light}>
          {REVIEW_NOTE}
        </ThemedText>
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </SafeAreaView>
    );
  }
  if (!permission) return <View style={styles.fill} />;

  const color = ready ? Brand.success : problem === null ? Brand.warning : Brand.danger;

  return (
    <View style={styles.fill}>
      <View style={styles.fill} onLayout={(e) => setLayout(e.nativeEvent.layout)}>
        <NativeFaceCamera
          ref={camera}
          style={StyleSheet.absoluteFill}
          onReady={(e) => {
            if (!e.nativeEvent.faceDetection) setStuck(true);
          }}
          onFaces={(e) => onFaces(e.nativeEvent.faces)}
          onCameraError={(e) => {
            setError(e.nativeEvent.message);
            setStuck(true);
          }}
        />
        {/* Where to put the face: centered, like the check in faceProblem. */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={[styles.guide, { borderColor: color }]} />
        </View>
        {face && (
          <View
            pointerEvents="none"
            style={[styles.box, { borderColor: color, left: face.x, top: face.y, width: face.width, height: face.height }]}
          />
        )}
      </View>
      <SafeAreaView edges={['top']} style={styles.top}>
        <View style={[styles.hint, { backgroundColor: color }]}>
          <ThemedText type="smallBold" style={styles.light}>
            {error ?? (ready ? 'Looks good. Take the photo.' : (problem ?? 'Hold still…'))}
          </ThemedText>
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {stuck && !ready && (
          <View style={styles.fallback}>
            <ThemedText type="small" style={styles.light}>
              Having trouble? {REVIEW_NOTE}
            </ThemedText>
            <Button title="Take photo anyway" variant="secondary" disabled={capturing} onPress={() => capture(true)} />
          </View>
        )}
        <View style={styles.bottom}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.side}>
            <ThemedText style={styles.light}>Cancel</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => capture()}
            disabled={!ready || capturing}
            accessibilityLabel="Take face photo"
            accessibilityState={{ disabled: !ready || capturing }}
            style={[styles.shutter, { borderColor: ready ? Brand.success : '#ffffff80', opacity: ready ? 1 : 0.4 }]}>
            {capturing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={[styles.shutterInner, { backgroundColor: ready ? '#fff' : '#ffffff80' }]} />
            )}
          </Pressable>
          <View style={styles.side} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const REVIEW_NOTE = 'A photo taken without the face check is reviewed by hand, so verification may take longer.';

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  light: { color: '#fff', textAlign: 'center' },
  guide: {
    width: '62%',
    aspectRatio: 0.78,
    borderRadius: 999,
    borderWidth: 3,
    borderStyle: 'dashed',
  },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 12 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', padding: Spacing.three },
  hint: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: Spacing.three },
  fallback: { gap: Spacing.two, marginHorizontal: Spacing.four, padding: Spacing.three, borderRadius: 16, backgroundColor: '#000000b0' },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  side: { width: 64 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29 },
});
