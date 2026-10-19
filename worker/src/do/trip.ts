import { DurableObject } from 'cloudflare:workers';

import { CUSTOMER_OFFLINE_MS, HEARTBEAT_MS, LOCATION_MIN_INTERVAL_MS, NO_LOCATION_WARN_MS, OWNER_REMINDER_MS } from '../lib/dropoff-config';
import { pushToUsers } from '../lib/push';
import type { Bindings, LatLng } from '../types';

type Attachment = { role: 'customer' | 'driver'; userId: number; ts?: number; since: number };
type Message = { t: string; [key: string]: unknown };
type Timers = { staleAt?: number; ownerAt?: number; presenceAt?: number };

const PING = JSON.stringify({ t: 'ping' });
const PONG = JSON.stringify({ t: 'pong' });

/** Live tracking room for one drop off (named by its room_id). */
export class Trip extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // Heartbeats are answered by the runtime, so they don't wake the object; it only records when each one came.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async start(transactionId: number) {
    await this.ctx.storage.put('transactionId', transactionId);
    await this.ctx.storage.put('tracking', true);
    await this.setTimers({ staleAt: Date.now() + NO_LOCATION_WARN_MS });
  }

  async notify(msg: Message) {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, msg);
  }

  /** Laundry is at the shop: stop tracking, remind the owner if they don't confirm. */
  async finish() {
    await this.ctx.storage.put('tracking', false);
    await this.setTimers({ staleAt: undefined, ownerAt: Date.now() + OWNER_REMINDER_MS });
  }

  /**
   * Whether the customer was on the trip within CUSTOMER_OFFLINE_MS (drivers may cancel only when not).
   * A closed socket keeps counting until then, so a dropped connection has time to come back.
   */
  async customerOnline(now = Date.now()) {
    if (this.ctx.getWebSockets('customer').some((ws) => this.alive(ws, now))) return true;
    return now - ((await this.ctx.storage.get<number>('customerSeenAt')) ?? 0) < CUSTOMER_OFFLINE_MS;
  }

  /**
   * Tells drivers when the customer comes or goes. A killed app or lost signal never sends a close,
   * so a customer whose heartbeat stops for CUSTOMER_OFFLINE_MS counts as gone and is disconnected.
   */
  async checkPresence(now = Date.now()) {
    for (const ws of this.ctx.getWebSockets('customer')) {
      if (!this.alive(ws, now)) this.close(ws);
    }
    const online = await this.customerOnline(now);
    if (online !== (await this.ctx.storage.get<boolean>('customerOnline'))) {
      await this.ctx.storage.put('customerOnline', online);
      this.toDrivers({ t: 'customer', online });
    }
    const watch = online && (await this.ctx.storage.get<boolean>('tracking'));
    await this.setTimers({ presenceAt: watch ? now + HEARTBEAT_MS : undefined });
  }

  /**
   * Trip over (cancelled, or the shop confirmed or was reminded): closes the room and wipes its storage, so a
   * finished trip keeps no data (nor the driver's last location) once it is no longer needed.
   */
  async stop() {
    for (const ws of this.ctx.getWebSockets()) this.close(ws);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Socket upgrade. routes/ws.ts has already checked the ticket and membership. */
  async fetch(request: Request): Promise<Response> {
    const role = request.headers.get('x-role') === 'driver' ? 'driver' : 'customer';
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, userId: Number(request.headers.get('x-user-id')), since: Date.now() } satisfies Attachment);
    if (role === 'customer') {
      const loc = await this.ctx.storage.get<LatLng>('loc');
      if (loc) this.send(server, { t: 'loc', ...loc });
      await this.checkPresence();
    } else {
      this.send(server, { t: 'customer', online: await this.customerOnline() });
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
    if (msg.t !== 'loc' || typeof msg.lat !== 'number' || typeof msg.lng !== 'number') return;
    const now = Date.now();
    if (att.ts && now - att.ts < LOCATION_MIN_INTERVAL_MS) return;
    ws.serializeAttachment({ ...att, ts: now } satisfies Attachment);

    const loc = { lat: msg.lat, lng: msg.lng };
    await this.ctx.storage.put('loc', loc);
    if (await this.ctx.storage.get<boolean>('tracking')) await this.setTimers({ staleAt: now + NO_LOCATION_WARN_MS });
    for (const customer of this.ctx.getWebSockets('customer')) this.send(customer, { t: 'loc', ...loc });
  }

  async webSocketClose(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.dropSocket(ws);
  }

  private async dropSocket(ws: WebSocket) {
    if ((ws.deserializeAttachment() as Attachment).role === 'customer') {
      // Remember when they were last heard from; the grace period runs from there, not from the close.
      const seen = Math.max((await this.ctx.storage.get<number>('customerSeenAt')) ?? 0, this.lastSeen(ws));
      await this.ctx.storage.put('customerSeenAt', seen);
      this.close(ws);
      await this.checkPresence();
    } else {
      this.close(ws);
    }
  }

  /** When the socket connected or last heartbeated, whichever is later. */
  private lastSeen(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment;
    return Math.max(att.since ?? 0, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0);
  }

  /** Open, and connected or heartbeated recently. */
  private alive(ws: WebSocket, now: number) {
    return ws.readyState === WebSocket.OPEN && now - this.lastSeen(ws) < CUSTOMER_OFFLINE_MS;
  }

  private close(ws: WebSocket) {
    try {
      ws.close(1000, 'bye');
    } catch {
      // already closed
    }
  }

  private toDrivers(msg: Message) {
    for (const driver of this.ctx.getWebSockets('driver')) this.send(driver, msg);
  }

  async alarm() {
    const now = Date.now();
    const timers = await this.timers();
    if (timers.staleAt !== undefined && timers.staleAt <= now) {
      await this.setTimers({ staleAt: undefined }); // warn once; the next location re-arms it
      for (const customer of this.ctx.getWebSockets('customer')) this.send(customer, { t: 'stale' });
    }
    if (timers.presenceAt !== undefined && timers.presenceAt <= now) {
      await this.checkPresence(now);
    }
    if (timers.ownerAt !== undefined && timers.ownerAt <= now) {
      await this.remindOwner();
      // The reminder is the last thing a finished trip does.
      await this.stop();
      return;
    }
  }

  private async remindOwner() {
    const id = await this.ctx.storage.get<number>('transactionId');
    const row = await this.env.DB.prepare(
      `SELECT s.owner_id FROM owner_transactions ot JOIN stores s ON s.id = ot.store_id
       WHERE ot.transaction_id = ? AND ot.status = 'pending'`,
    )
      .bind(id)
      .first<{ owner_id: number | null }>();
    if (row?.owner_id) {
      await pushToUsers(
        this.env,
        [row.owner_id],
        'Drop off waiting',
        'A laundry drop off is waiting for your confirmation.',
        { transaction_id: id },
        'ownerOrder',
      );
    }
  }

  private async timers() {
    return (await this.ctx.storage.get<Timers>('timers')) ?? {};
  }

  private async setTimers(patch: Timers) {
    const next = { ...(await this.timers()), ...patch };
    await this.ctx.storage.put('timers', next);
    const at = Math.min(next.staleAt ?? Infinity, next.ownerAt ?? Infinity, next.presenceAt ?? Infinity);
    if (Number.isFinite(at)) await this.ctx.storage.setAlarm(at);
    else await this.ctx.storage.deleteAlarm();
  }

  private send(ws: WebSocket, msg: Message) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closing
    }
  }
}
