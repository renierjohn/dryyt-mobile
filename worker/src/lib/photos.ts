import type { Context } from 'hono';

import { fail } from './http';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * SQL for a short tag that changes whenever a driver retakes either photo, for the app to put in the photo URL so its
 * image cache (keyed by URL) never shows the old one. Keys end in `-<uuid>.jpg|png`: this is a slice of each UUID, so
 * the keys themselves stay server-side. `t` is the driver_data table alias.
 */
export const driverPhotoVersion = (t: string) =>
  `COALESCE(substr(${t}.photo_face, -12, 8), '') || '-' || COALESCE(substr(${t}.photo_id, -12, 8), '')`;

/** Image type from the file's first bytes; React Native doesn't reliably send the Content-Type of a Blob body. */
function imageType(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: 'image/png', ext: 'png' };
  return null;
}

/** The raw request body as a JPEG or PNG under `maxBytes` (5 MB by default), or 400. */
export async function readPhoto(c: Context, maxBytes = MAX_PHOTO_BYTES) {
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > maxBytes) fail(400, `Photo must be under ${maxBytes / (1024 * 1024)} MB`);
  const image = imageType(new Uint8Array(body, 0, Math.min(4, body.byteLength)));
  if (!image) fail(400, 'Photo must be a JPEG or PNG');
  return { body, ...image };
}

/** Streams an R2 photo back with its stored type, or 404. */
export async function photoResponse(bucket: R2Bucket, key: string | null | undefined, cacheControl = 'private, max-age=3600') {
  const object = key ? await bucket.get(key) : null;
  if (!object) fail(404, 'No photo yet');
  return new Response(object.body, {
    headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': cacheControl },
  });
}
