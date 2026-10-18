import { requireNativeView } from 'expo';
import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

/** A face box in view space, normalized to 0..1 of the view's size. */
export type FaceBox = { x: number; y: number; width: number; height: number };

export type NativeFaceCameraProps = ViewProps & {
  ref?: Ref<NativeFaceCameraRef>;
  /** `faceDetection` is false when this phone's camera can't detect faces. */
  onReady?: (event: { nativeEvent: { faceDetection: boolean } }) => void;
  onFaces?: (event: { nativeEvent: { faces: FaceBox[] } }) => void;
  onCameraError?: (event: { nativeEvent: { message: string } }) => void;
};

export type NativeFaceCameraRef = {
  /** A JPEG as a file:// URI. */
  takePhoto: () => Promise<string>;
};

/** Android front camera preview with the camera's own face detection. */
export const NativeFaceCamera = requireNativeView<NativeFaceCameraProps>('FaceCamera');
