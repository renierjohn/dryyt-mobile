/** What the face check needs from a detected face (react-native-vision-camera-face-detector's Face). */
export type DetectedFace = {
  bounds: { x: number; y: number; width: number; height: number };
  yawAngle: number;
  pitchAngle: number;
  rollAngle: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
};

/** Head turned or tilted more than this (degrees) is rejected. */
const MAX_ANGLE = 12;
/** Face width as a share of the preview width. */
const MIN_FACE = 0.35;
const MAX_FACE = 0.8;
/** Face center must be within this share of the preview size from its center. */
const MAX_OFFSET = 0.15;
const MIN_EYE_OPEN = 0.5;
/** Why the face can't be captured yet, or null when it can. `view` is the preview's size. */
export function faceProblem(faces: DetectedFace[], view: { width: number; height: number }): string | null {
  if (faces.length === 0) return 'Place your face inside the frame';
  if (faces.length > 1) return 'Only one face, please';
  const { bounds, yawAngle, pitchAngle, rollAngle, leftEyeOpenProbability: left, rightEyeOpenProbability: right } = faces[0];
  const share = bounds.width / view.width;
  if (share < MIN_FACE) return 'Move closer';
  if (share > MAX_FACE) return 'Move back a little';
  const dx = (bounds.x + bounds.width / 2) / view.width - 0.5;
  const dy = (bounds.y + bounds.height / 2) / view.height - 0.5;
  if (Math.abs(dx) > MAX_OFFSET || Math.abs(dy) > MAX_OFFSET) return 'Center your face in the frame';
  if (Math.abs(yawAngle) > MAX_ANGLE || Math.abs(pitchAngle) > MAX_ANGLE || Math.abs(rollAngle) > MAX_ANGLE) return 'Look straight at the camera';
  if ((left ?? 1) < MIN_EYE_OPEN || (right ?? 1) < MIN_EYE_OPEN) return 'Keep your eyes open';
  return null;
}
