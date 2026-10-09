import { DurableObject } from 'cloudflare:workers';

import { CONFIRM_TIMEOUT_MS, DRIVER_STALE_MS, LOCATION_MIN_INTERVAL_MS, REJECT_COOLDOWN_MS, SEARCH_TIMEOUT_MS } from '../lib/dropoff-config';
import { distanceColour, geohash, haversineKm, MAX_KM, nearbyCells } from '../lib/geo';
import { firstName, maskPhone } from '../lib/privacy';
import { pushToUsers } from '../lib/push';
import type { Bindings, LatLng } from '../types';

export type Message = { t: string; [key: string]: unknown };

export type NewRequest = {
  id: number;
  group: string;
  customerId: number;
  storeName: string;
  address: string;
  /** Nearby drivers see only the first name and a masked phone until they're confirmed. */
  customerName: string;
  customerPhone: string;
  customer: LatLng;
  shop: LatLng;
  deliveryFee: number;
  totalDeliveryFee: number;
  /** Drivers this shop blocked, captured when the request is created. */
  blocked: number[];
};

type DispatchRequest = NewRequest & { status: 'searching' | 'driver_accepted'; driverId?: number; deadline: number };

type DriverAttachment = { role: 'driver'; userId: number; loc?: LatLng; ts?: number };
type CustomerAttachment = { role: 'customer'; userId: number; transactionId: number };
type Attachment = DriverAttachment | CustomerAttachment;

function addTo(cells: Map<string, Set<number>>, cell: string, id: number) {
  const set = cells.get(cell) ?? new Set<number>();
  set.add(id);
  cells.set(cell, set);
}

/**
 * One per group_id. Holds online drivers (location in each socket's attachment, so it survives hibernation)
 * and drop offs that are searching or waiting for the customer to confirm (in storage).
 */
export class Dispatch extends DurableObject<Bindings> {
  private requests = new Map<number, DispatchRequest>();
  /** `${customerId}:${driverId}` → until (ms): drivers the customer turned down. */
  private cooldowns: Record<string, number> = {};
  /** geohash cell → driver ids. Rebuilt from socket attachments when null (after hibernation). */
  private cells: Map<string, Set<number>> | null = null;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const r of (await ctx.storage.get<DispatchRequest[]>('requests')) ?? []) this.requests.set(r.id, r);
      this.cooldowns = (await ctx.storage.get<Record<string, number>>('cooldowns')) ?? {};
    });
  }

  /** Socket upgrade. routes/ws.ts has already checked the ticket and set these headers. */
  async fetch(request: Request): Promise<Response> {
    const userId = Number(request.headers.get('x-user-id'));
    const [client, server] = Object.values(new WebSocketPair());

    if (request.headers.get('x-role') === 'driver') {
      this.ctx.acceptWebSocket(server, ['driver', `u:${userId}`]);
      server.serializeAttachment({ role: 'driver', userId } satisfies DriverAttachment);
    } else {
      const transactionId = Number(request.headers.get('x-transaction-id'));
      this.ctx.acceptWebSocket(server, ['customer', `tx:${transactionId}`]);
      server.serializeAttachment({ role: 'customer', userId, transactionId } satisfies CustomerAttachment);
      const r = this.requests.get(transactionId);
      this.send(server, { t: 'drivers', items: r ? this.driversFor(r) : [] });
      if (r?.status === 'driver_accepted') await this.announceDriver(r);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as Attachment;
    if (att.role !== 'driver' || typeof data !== 'string') return;
    let msg: Message;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'loc') this.onLocation(ws, att, msg);
    else if (msg.t === 'accept' && typeof msg.transaction_id === 'number') await this.accept(ws, att, msg.transaction_id);
  }

  async webSocketClose(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  // ---- RPC from the Worker ----

  async newRequest(r: NewRequest) {
    const req: DispatchRequest = { ...r, status: 'searching', deadline: Date.now() + SEARCH_TIMEOUT_MS };
    this.requests.set(req.id, req);
    await this.save();
    this.refreshDriversNear(req.customer);
    this.ctx.waitUntil(this.pushIdleDrivers(req));
  }

  /** `driverId` lets the message still reach the driver when the entry is already gone (timeout race). */
  async removeRequest(id: number, driverMessage?: Message, driverId?: number) {
    const r = this.requests.get(id);
    const target = driverId ?? r?.driverId;
    if (r) {
      this.requests.delete(id);
      await this.save();
    }
    if (target && driverMessage) this.toDriver(target, driverMessage);
    if (r) this.refreshDriversNear(r.customer);
  }

  /** `fallback` rebuilds the entry if a timeout dropped it; `releasedDriverId` is told even then. */
  async requeue(id: number, fallback?: NewRequest, releasedDriverId?: number) {
    const found = this.requests.get(id);
    const base = found ?? fallback;
    if (!base) return;
    const driverId = found?.driverId ?? releasedDriverId;
    if (driverId) this.toDriver(driverId, { t: 'released', transaction_id: id });
    this.requests.set(id, { ...base, status: 'searching', driverId: undefined, deadline: Date.now() + SEARCH_TIMEOUT_MS });
    await this.save();
    this.toCustomer(id, { t: 'searching' });
    this.refreshDriversNear(base.customer);
  }

  /** Customer turned the driver down: requeue, and keep that driver off this customer's drop offs for a while. */
  async reject(id: number, fallback: NewRequest, driverId: number) {
    this.cooldowns[`${fallback.customerId}:${driverId}`] = Date.now() + REJECT_COOLDOWN_MS;
    await this.requeue(id, fallback, driverId);
  }

  // ---- Timeouts ----

  async alarm() {
    const now = Date.now();
    const db = this.env.DB;
    for (const r of [...this.requests.values()]) {
      if (r.deadline > now) continue;
      if (r.status === 'searching') {
        const expired = await db
          .prepare("UPDATE transactions SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND status = 'searching'")
          .bind(r.id)
          .run();
        if (expired.meta.changes > 0) {
          this.requests.delete(r.id);
          this.toCustomer(r.id, { t: 'expired' });
          this.refreshDriversNear(r.customer);
          continue;
        }
        // An accept (or cancel) got there first. Re-read D1 and the live entry, not the snapshot.
        const row = await db
          .prepare('SELECT status, driver_id FROM transactions WHERE id = ?')
          .bind(r.id)
          .first<{ status: string; driver_id: number | null }>();
        const live = this.requests.get(r.id);
        if (row?.status === 'driver_accepted' && row.driver_id && live?.status === 'searching') {
          // The accept won in D1 but its hold never reached memory (save threw, or the object restarted).
          // Hold it here so the confirm timeout can still release the driver.
          const held: DispatchRequest = { ...live, status: 'driver_accepted', driverId: row.driver_id, deadline: now + CONFIRM_TIMEOUT_MS };
          this.requests.set(r.id, held);
          await this.save();
          await this.announceDriver(held);
          this.refreshDriversNear(held.customer);
        } else if (row?.status === 'searching' || row?.status === 'driver_accepted') {
          // The accept path owns it; make sure a stale deadline cannot loop the alarm.
          if (live && live.deadline <= now) this.requests.set(r.id, { ...live, deadline: now + CONFIRM_TIMEOUT_MS });
        } else {
          this.requests.delete(r.id);
          this.refreshDriversNear(r.customer);
        }
        continue;
      }
      // One batch: the busy reset goes first, guarded by the old state, so it lands only with the status change.
      const [, released] = await db.batch([
        db
          .prepare("UPDATE drivers SET busy = 0 WHERE user_id = (SELECT driver_id FROM transactions WHERE id = ? AND status = 'driver_accepted' AND driver_id = ?)")
          .bind(r.id, r.driverId ?? null),
        db
          .prepare(
            "UPDATE transactions SET status = 'searching', driver_id = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'driver_accepted' AND driver_id = ?",
          )
          .bind(r.id, r.driverId ?? null),
      ]);
      if (released.meta.changes === 0) {
        // Confirmed or cancelled meanwhile, the customer turned the driver down (now searching again),
        // or another driver holds it now.
        const row = await db
          .prepare('SELECT status, driver_id FROM transactions WHERE id = ?')
          .bind(r.id)
          .first<{ status: string; driver_id: number | null }>();
        if (row?.status === 'searching') {
          this.requests.set(r.id, { ...r, status: 'searching', driverId: undefined, deadline: now + SEARCH_TIMEOUT_MS });
        } else if (row?.status === 'driver_accepted' && row.driver_id) {
          this.requests.set(r.id, { ...r, driverId: row.driver_id, deadline: now + CONFIRM_TIMEOUT_MS });
        } else {
          this.requests.delete(r.id);
        }
        continue;
      }
      await this.requeue(r.id);
    }
    await this.save();
  }

  // ---- Driver messages ----

  private onLocation(ws: WebSocket, att: DriverAttachment, msg: Message) {
    const { lat, lng } = msg;
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const now = Date.now();
    if (att.ts && now - att.ts < LOCATION_MIN_INTERVAL_MS) return;

    const before = att.loc;
    const loc = { lat, lng };
    this.moveDriver(att.userId, before, loc);
    ws.serializeAttachment({ ...att, loc, ts: now } satisfies DriverAttachment);

    this.send(ws, { t: 'requests', items: this.requestsFor(att.userId, loc) });
    for (const r of this.requests.values()) {
      if (r.status !== 'searching') continue;
      const wasNear = before !== undefined && haversineKm(before, r.customer) <= MAX_KM;
      if (wasNear || haversineKm(loc, r.customer) <= MAX_KM) this.toCustomer(r.id, { t: 'drivers', items: this.driversFor(r) });
    }
  }

  private async accept(ws: WebSocket, att: DriverAttachment, id: number) {
    const taken = () => this.send(ws, { t: 'taken', transaction_id: id });
    const r = this.requests.get(id);
    if (!r || r.status !== 'searching' || this.excluded(r, att.userId)) return taken();
    if (!att.loc) return this.send(ws, { t: 'error', message: 'Waiting for your location, try again in a moment' });
    if (haversineKm(att.loc, r.customer) > MAX_KM) return taken();

    // D1 decides the race: messages interleave at every await, so the in-memory check above is only a fast path.
    const db = this.env.DB;
    const busy = await db.prepare('UPDATE drivers SET busy = 1 WHERE user_id = ? AND busy = 0').bind(att.userId).run();
    if (busy.meta.changes === 0) return this.send(ws, { t: 'error', message: 'Finish your active job first' });
    try {
      const won = await db
        .prepare(
          "UPDATE transactions SET driver_id = ?, status = 'driver_accepted', updated_at = datetime('now') WHERE id = ? AND status = 'searching'",
        )
        .bind(att.userId, id)
        .run();
      if (won.meta.changes === 0) {
        await db.prepare('UPDATE drivers SET busy = 0 WHERE user_id = ?').bind(att.userId).run();
        return taken();
      }

      // The entry may be gone if a cancel or an expiry ran while we awaited D1; D1 says who really holds it.
      let base = this.requests.get(id);
      if (!base) {
        const row = await db.prepare('SELECT status, driver_id FROM transactions WHERE id = ?').bind(id).first<{ status: string; driver_id: number | null }>();
        if (row?.status !== 'driver_accepted' || row.driver_id !== att.userId) return this.send(ws, { t: 'cancelled', transaction_id: id });
        base = r;
      }

      const held: DispatchRequest = { ...base, status: 'driver_accepted', driverId: att.userId, deadline: Date.now() + CONFIRM_TIMEOUT_MS };
      this.requests.set(id, held);
      await this.save();
      this.send(ws, { t: 'accepted', transaction_id: id });
      await this.announceDriver(held);
      for (const d of this.nearbyDrivers(held.customer)) this.toDriver(d.userId, { t: 'taken', transaction_id: id });
      this.refreshDriversNear(held.customer);
    } catch (err) {
      console.error('accept failed', err);
      try {
        const row = await db.prepare('SELECT status, driver_id FROM transactions WHERE id = ?').bind(id).first<{ status: string; driver_id: number | null }>();
        if (!(row?.status === 'driver_accepted' && row.driver_id === att.userId)) {
          await db.prepare('UPDATE drivers SET busy = 0 WHERE user_id = ?').bind(att.userId).run();
        }
      } catch (err2) {
        console.error('accept cleanup failed', err2);
      }
      this.send(ws, { t: 'error', message: 'Could not accept, try again' });
    }
  }

  private async dropSocket(ws: WebSocket) {
    try {
      ws.close(1000, 'bye');
    } catch {
      // already closed
    }
    const att = ws.deserializeAttachment() as Attachment;
    if (att.role !== 'driver' || !att.loc) return;
    const others = this.ctx.getWebSockets(`u:${att.userId}`).filter((s) => s !== ws);
    if (others.length === 0) this.moveDriver(att.userId, att.loc, undefined);
    await this.env.DB.prepare("UPDATE drivers SET lat = ?, lng = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(att.loc.lat, att.loc.lng, att.userId)
      .run();
    for (const r of this.requests.values()) {
      if (r.status === 'searching' && haversineKm(att.loc, r.customer) <= MAX_KM) this.toCustomer(r.id, { t: 'drivers', items: this.driversFor(r) });
    }
  }

  // ---- Matching ----

  private index(): Map<string, Set<number>> {
    if (this.cells) return this.cells;
    const cells = new Map<string, Set<number>>();
    for (const ws of this.ctx.getWebSockets('driver')) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att.role === 'driver' && att.loc) addTo(cells, geohash(att.loc), att.userId);
    }
    return (this.cells = cells);
  }

  private moveDriver(id: number, from: LatLng | undefined, to: LatLng | undefined) {
    const cells = this.index();
    if (from) cells.get(geohash(from))?.delete(id);
    if (to) addTo(cells, geohash(to), id);
  }

  /** Latest location of a connected driver (a reconnect can briefly leave two sockets). */
  private driverState(userId: number): DriverAttachment | null {
    let best: DriverAttachment | null = null;
    for (const ws of this.ctx.getWebSockets(`u:${userId}`)) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att.role === 'driver' && att.loc && att.ts && (!best || att.ts > (best.ts ?? 0))) best = att;
    }
    return best;
  }

  /** Blocked by the shop, or recently turned down by this customer. */
  private excluded(r: NewRequest, driverId: number) {
    return r.blocked.includes(driverId) || (this.cooldowns[`${r.customerId}:${driverId}`] ?? 0) > Date.now();
  }

  private holding(userId: number) {
    for (const r of this.requests.values()) if (r.driverId === userId) return true;
    return false;
  }

  /** Connected, fresh, free drivers within MAX_KM of `p`. */
  private nearbyDrivers(p: LatLng) {
    const now = Date.now();
    const cells = this.index();
    const found: { userId: number; loc: LatLng; km: number }[] = [];
    const seen = new Set<number>();
    for (const cell of nearbyCells(p)) {
      for (const userId of cells.get(cell) ?? []) {
        // A stale cell can still hold the id after a reconnect moved the driver.
        if (seen.has(userId)) continue;
        seen.add(userId);
        const state = this.driverState(userId);
        if (!state?.loc || now - (state.ts ?? 0) > DRIVER_STALE_MS || this.holding(userId)) continue;
        const km = haversineKm(p, state.loc);
        if (km <= MAX_KM) found.push({ userId, loc: state.loc, km });
      }
    }
    return found.sort((a, b) => a.km - b.km);
  }

  /** What the customer sees: positions and colours only. */
  private driversFor(r: DispatchRequest) {
    return this.nearbyDrivers(r.customer)
      .filter((d) => !this.excluded(r, d.userId))
      .map((d) => ({ lat: d.loc.lat, lng: d.loc.lng, colour: distanceColour(d.km) }));
  }

  private requestsFor(driverId: number, loc: LatLng) {
    const items = [];
    for (const r of this.requests.values()) {
      if (r.status !== 'searching' || this.excluded(r, driverId)) continue;
      const km = haversineKm(loc, r.customer);
      if (km > MAX_KM) continue;
      items.push({
        transaction_id: r.id,
        store_name: r.storeName,
        address: r.address,
        // Requests saved before these fields existed have none.
        customer_name: firstName(r.customerName ?? ''),
        customer_phone: maskPhone(r.customerPhone ?? ''),
        lat: r.customer.lat,
        lng: r.customer.lng,
        shop_lat: r.shop.lat,
        shop_lng: r.shop.lng,
        distance_km: Math.round(km * 10) / 10,
        colour: distanceColour(km),
        delivery_fee: r.deliveryFee,
        total_delivery_fee: r.totalDeliveryFee,
      });
    }
    return items.sort((a, b) => a.distance_km - b.distance_km);
  }

  private refreshDriversNear(p: LatLng) {
    for (const d of this.nearbyDrivers(p)) this.toDriver(d.userId, { t: 'requests', items: this.requestsFor(d.userId, d.loc) });
  }

  private async announceDriver(r: DispatchRequest) {
    const driver = await this.env.DB.prepare('SELECT name, phone FROM users WHERE id = ?').bind(r.driverId).first<{ name: string; phone: string }>();
    this.toCustomer(r.id, { t: 'driver_accepted', transaction_id: r.id, driver, total_delivery_fee: r.totalDeliveryFee });
  }

  /** Online, free drivers in this group whose app is closed (no socket), last seen within MAX_KM or never located. */
  private async pushIdleDrivers(r: DispatchRequest) {
    const { results } = await this.env.DB.prepare(
      `SELECT d.user_id, d.lat, d.lng FROM drivers d JOIN users u ON u.id = d.user_id
       WHERE d.group_id = ? AND d.online = 1 AND d.busy = 0 AND u.push_token IS NOT NULL`,
    )
      .bind(r.group)
      .all<{ user_id: number; lat: number | null; lng: number | null }>();
    const ids = results
      .filter((d) => this.ctx.getWebSockets(`u:${d.user_id}`).length === 0 && !this.excluded(r, d.user_id))
      .filter((d) => d.lat === null || d.lng === null || haversineKm({ lat: d.lat, lng: d.lng }, r.customer) <= MAX_KM)
      .map((d) => d.user_id);
    await pushToUsers(this.env.DB, ids, 'New drop off nearby', `${r.storeName}: open Dryyt to accept.`, { transaction_id: r.id }, 'newDropoff');
  }

  // ---- Plumbing ----

  private async save() {
    const now = Date.now();
    for (const [key, until] of Object.entries(this.cooldowns)) if (until <= now) delete this.cooldowns[key];
    await this.ctx.storage.put({ requests: [...this.requests.values()], cooldowns: this.cooldowns });
    const next = Math.min(...[...this.requests.values()].map((r) => r.deadline));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  private send(ws: WebSocket, msg: Message) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closing
    }
  }

  private toDriver(userId: number, msg: Message) {
    for (const ws of this.ctx.getWebSockets(`u:${userId}`)) this.send(ws, msg);
  }

  private toCustomer(transactionId: number, msg: Message) {
    for (const ws of this.ctx.getWebSockets(`tx:${transactionId}`)) this.send(ws, msg);
  }
}
