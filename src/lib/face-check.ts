/** A detected face's box in view coordinates (the camera's own face detection gives only the box). */
export type FaceBounds = { x: number; y: number; width: number; height: number };

/** Face width as a share of the preview width. */
const MIN_FACE = 0.35;
const MAX_FACE = 0.8;
/** Face center must be within this share of the preview size from its center. */
const MAX_OFFSET = 0.15;
/** Why the face can't be captured yet, or null when it can. `view` is the preview's size. */
export function faceProblem(faces: FaceBounds[], view: { width: number; height: number }): string | null {
  if (faces.length === 0) return 'Place your face inside the frame';
  if (faces.length > 1) return 'Only one face, please';
  const bounds = faces[0];
  const share = bounds.width / view.width;
  if (share < MIN_FACE) return 'Move closer';
  if (share > MAX_FACE) return 'Move back a little';
  const dx = (bounds.x + bounds.width / 2) / view.width - 0.5;
  const dy = (bounds.y + bounds.height / 2) / view.height - 0.5;
  if (Math.abs(dx) > MAX_OFFSET || Math.abs(dy) > MAX_OFFSET) return 'Center your face in the frame';
  return null;
}
