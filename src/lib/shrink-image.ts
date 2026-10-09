import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Uploads must come out under this. */
export const MAX_IMAGE_BYTES = 1024 * 1024;
/** Longest side to start from; plenty for a phone screen. */
const START_SIDE = 1600;
/** Tried in turn, from sharpest to smallest, until one fits under MAX_IMAGE_BYTES. */
const STEPS = [
  { scale: 1, compress: 0.8 },
  { scale: 1, compress: 0.6 },
  { scale: 0.75, compress: 0.6 },
  { scale: 0.5, compress: 0.6 },
  { scale: 0.35, compress: 0.5 },
];

/**
 * A JPEG copy of a picked photo under MAX_IMAGE_BYTES: shrinks the longest side to START_SIDE,
 * then trades size and quality down until it fits. `width`/`height` are the picked photo's size.
 */
export async function shrinkImage(uri: string, width: number, height: number) {
  const longest = Math.max(width, height, 1);
  for (const { scale, compress } of STEPS) {
    const side = Math.round(Math.min(longest, START_SIDE) * scale);
    const size = width >= height ? { width: side } : { height: side };
    const image = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
    const saved = await image.saveAsync({ compress, format: SaveFormat.JPEG });
    // Size from the file system: no need to read the file.
    if ((new File(saved.uri).size ?? Infinity) < MAX_IMAGE_BYTES) return { uri: saved.uri, type: 'image/jpeg' };
  }
  throw new Error('This photo is too large even after resizing. Try another one.');
}
