import { env, SELF } from 'cloudflare:test';

import { api, registerUser } from '../helpers';
import { openSocket } from './socket';

/** Customer location ~1 km from the test shop. */
export const HOME = { lat: 14.5600, lng: 121.0300 };

/** A laundry shop in its own group (own Dispatch object, own rates) so tests never see each other's drivers. */
export async function makeShop({ ownerId }: { ownerId?: number } = {}) {
  const group = `g-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare('INSERT INTO rates (group_id, base_fee, rate_per_km, commission_pct) VALUES (?, 4000, 1000, 10)').bind(group).run();
  const store = await env.DB.prepare(
    "INSERT INTO stores (name, type, address, group_id, lat, lng, owner_id) VALUES ('Test Laundry', 'laundry', '1 Shop St, Makati', ?, 14.5547, 121.0244, ?) RETURNING id",
  )
    .bind(group, ownerId ?? null)
    .first<{ id: number }>();
  return { storeId: store!.id, group };
}

/** A driver who is online in `group`. */
export async function makeDriver(group: string) {
  const driver = await registerUser('driver');
  await env.DB.prepare('UPDATE drivers SET group_id = ?, online = 1 WHERE user_id = ?').bind(group, driver.user.id).run();
  return driver;
}

export const createDropoff = (token: string, overrides: Record<string, unknown> = {}) =>
  api('/dropoffs', { token, body: { store_id: 4, ...HOME, address: '1 Customer St, Makati', ...overrides } });

/** Drop off with a driver who accepted and is waiting for the customer to confirm. */
export async function acceptedDropoff({ ownerId }: { ownerId?: number } = {}) {
  const { storeId, group } = await makeShop({ ownerId });
  const driver = await makeDriver(group);
  const customer = await registerUser('customer');
  const id = (await createDropoff(customer.token, { store_id: storeId })).body.dropoff.id as number;

  const driverSock = await openSocket(driver.token, 'dispatch');
  driverSock.send({ t: 'loc', lat: HOME.lat + 0.01, lng: HOME.lng });
  await driverSock.next('requests');
  driverSock.send({ t: 'accept', transaction_id: id });
  await driverSock.next('accepted');
  return { storeId, group, driver, customer, id, driverSock };
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

export async function uploadProof(id: number, token: string, body: Uint8Array = JPEG, type = 'image/jpeg') {
  const res = await SELF.fetch(`https://api.test/dropoffs/${id}/proof-upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': type },
    body,
  });
  return { status: res.status, body: (await res.json()) as { key?: string; error?: string } };
}

/** Drop off that the driver has left at the shop, waiting for the owner. */
export async function droppedOffDropoff({ ownerId }: { ownerId?: number } = {}) {
  const flow = await acceptedDropoff({ ownerId });
  const room = (await api(`/dropoffs/${flow.id}/confirm-driver`, { token: flow.customer.token, method: 'POST' })).body.dropoff.room_id as string;
  await api(`/dropoffs/${flow.id}/picked-up`, { token: flow.driver.token, method: 'POST' });
  const { key } = (await uploadProof(flow.id, flow.driver.token)).body;
  await api(`/dropoffs/${flow.id}/drop`, { token: flow.driver.token, body: { weight_kg: 6.5, laundry_fee: 25000, notes: 'Two bags', proof_photo_key: key } });
  return { ...flow, room };
}
