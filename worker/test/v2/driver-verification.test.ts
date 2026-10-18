import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

import { api, registerUser } from '../helpers';
import { acceptedDropoff, JPEG } from './helpers';
import { closeAll } from './socket';

afterEach(closeAll);

const upload = async (kind: string, token: string, body: Uint8Array = JPEG, query = '') => {
  const res = await SELF.fetch(`https://api.test/drivers/me/verification/photo/${kind}${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
    body,
  });
  return { status: res.status, body: (await res.json()) as { verification?: Record<string, unknown>; error?: string } };
};

const verify = (userId: number) => env.DB.prepare('UPDATE driver_data SET status = 1 WHERE user_id = ?').bind(userId).run();
const statusOf = async (userId: number) => (await env.DB.prepare('SELECT status FROM driver_data WHERE user_id = ?').bind(userId).first())?.status;

describe('driver verification', () => {
  it('flags a face photo that skipped the live face check until a checked one replaces it', async () => {
    const driver = await registerUser('driver');
    const check = async () => (await api('/drivers/me/verification', { token: driver.token })).body.verification.face_check;
    expect((await upload('face', driver.token, JPEG, '?face_check=skipped')).body.verification).toMatchObject({ face_check: 'skipped' });
    // The license photo leaves the face flag alone.
    await upload('id', driver.token);
    expect(await check()).toBe('skipped');
    await upload('face', driver.token);
    expect(await check()).toBe('passed');
  });

  it('starts empty and unverified', async () => {
    const driver = await registerUser('driver');
    expect((await api('/drivers/me/verification', { token: driver.token })).body).toEqual({
      verification: { has_face: false, has_id: false, photo_version: '-', face_check: null, notes: '', verified: false },
    });
  });

  it('saves photos and the license plate, and serves the photos back', async () => {
    const driver = await registerUser('driver');
    expect((await upload('face', driver.token)).status).toBe(201);
    const { verification } = (await upload('id', driver.token)).body;
    expect(verification).toMatchObject({ has_face: true, has_id: true });
    expect((await api('/drivers/me/verification', { token: driver.token, body: { notes: ' ABC 1234 ' } })).body.verification).toEqual({
      has_face: true,
      has_id: true,
      photo_version: verification?.photo_version,
      face_check: 'passed',
      notes: 'ABC 1234',
      verified: false,
    });

    const photo = await SELF.fetch('https://api.test/drivers/me/verification/photo/face', { headers: { authorization: `Bearer ${driver.token}` } });
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(JPEG);
  });

  it('changes the photo version on each retake, so the app never shows a cached old photo', async () => {
    const driver = await registerUser('driver');
    const version = async (kind: string) => String((await upload(kind, driver.token)).body.verification?.photo_version);
    const face = await version('face');
    expect(face).toMatch(/^[0-9a-f]{8}-$/);
    const both = await version('id');
    expect(both).toMatch(new RegExp(`^${face}[0-9a-f]{8}$`));
    expect(await version('face')).not.toBe(both);
  });

  it('rejects non-images and unknown photo kinds', async () => {
    const driver = await registerUser('driver');
    expect((await upload('face', driver.token, new Uint8Array([1, 2, 3]))).status).toBe(400);
    expect((await upload('selfie', driver.token)).status).toBe(404);
  });

  it('shows the badge once a developer verifies, then locks the details', async () => {
    const driver = await registerUser('driver');
    await upload('face', driver.token);
    await api('/drivers/me/verification', { token: driver.token, body: { notes: 'ABC 1234' } });
    await verify(driver.user.id);
    expect((await api('/drivers/me/verification', { token: driver.token })).body.verification.verified).toBe(true);

    expect(await api('/drivers/me/verification', { token: driver.token, body: { notes: 'XYZ 9' } })).toEqual({
      status: 409,
      body: { error: 'Your details are verified and can no longer be changed' },
    });
    expect((await upload('face', driver.token)).status).toBe(409);
    expect((await upload('id', driver.token)).status).toBe(409);
    expect((await api('/drivers/me/verification', { token: driver.token })).body.verification).toEqual({
      has_face: true,
      has_id: false,
      photo_version: expect.stringMatching(/^[0-9a-f]{8}-$/),
      face_check: 'passed',
      notes: 'ABC 1234',
      verified: true,
    });

    // Unverified by a developer: editable again.
    await env.DB.prepare('UPDATE driver_data SET status = 0 WHERE user_id = ?').bind(driver.user.id).run();
    expect((await api('/drivers/me/verification', { token: driver.token, body: { notes: 'XYZ 9' } })).status).toBe(200);
    expect((await upload('id', driver.token)).status).toBe(201);
    expect(await statusOf(driver.user.id)).toBe(0);
  });

  it('cannot be set verified through the API', async () => {
    const driver = await registerUser('driver');
    await api('/drivers/me/verification', { token: driver.token, body: { notes: 'ABC 1234', status: 1 } });
    expect(await statusOf(driver.user.id)).toBe(0);
  });

  it('is for drivers only', async () => {
    const customer = await registerUser('customer');
    expect((await api('/drivers/me/verification', { token: customer.token })).status).toBe(403);
    await expect(env.DB.prepare('INSERT INTO driver_data (user_id) VALUES (?)').bind(customer.user.id).run()).rejects.toThrow(/must be a driver/);
  });
});

describe("customer view of the driver's verification", () => {
  const photo = (id: number, kind: string, token: string) =>
    SELF.fetch(`https://api.test/dropoffs/${id}/driver-photo/${kind}`, { headers: { authorization: `Bearer ${token}` } });

  it('shows the assigned driver photos, plate and badge while deciding and on the trip', async () => {
    const { driver, customer, id } = await acceptedDropoff();
    await upload('face', driver.token);
    await api('/drivers/me/verification', { token: driver.token, body: { notes: 'ABC 1234' } });
    await verify(driver.user.id);

    const seen = (await api(`/dropoffs/${id}`, { token: customer.token })).body.dropoff;
    expect(seen).toMatchObject({ driver_has_face: true, driver_has_id: false, driver_notes: 'ABC 1234', driver_verified: true });
    expect(seen).not.toHaveProperty('driver_photo_face');
    const { verification } = (await api('/drivers/me/verification', { token: driver.token })).body;
    expect(seen.driver_photo_version).toBe(verification.photo_version);

    const face = await photo(id, 'face', customer.token);
    expect(face.status).toBe(200);
    expect(new Uint8Array(await face.arrayBuffer())).toEqual(JPEG);
    expect((await photo(id, 'id', customer.token)).status).toBe(404);
  });

  it('hides the photos from other customers and once the drop off is at the shop', async () => {
    const { driver, customer, id } = await acceptedDropoff();
    await upload('face', driver.token);
    const stranger = await registerUser('customer');
    expect((await photo(id, 'face', stranger.token)).status).toBe(404);

    await env.DB.prepare("UPDATE transactions SET status = 'dropped_off' WHERE id = ?").bind(id).run();
    expect((await photo(id, 'face', customer.token)).status).toBe(404);
  });
});
