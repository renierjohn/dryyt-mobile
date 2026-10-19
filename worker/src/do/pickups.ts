import { DurableObject } from 'cloudflare:workers';

import { LOCATION_MIN_INTERVAL_MS, PAYMENT_AUTO_CONFIRM_MS, PAYMENT_REMINDER_MS, PAYMENT_REMINDERS } from '../lib/dropoff-config';
import { getOrder, hidePhone, listOrders } from '../lib/orders';
import { pushToUsers } from '../lib/push';
import type { Bindings, LatLng } from '../types';

type Message = { t: string; [key: string]: unknown };

const PING = JSON.stringify({ t: 'ping' });
const PONG = JSON.stringify({ t: 'pong' });
/** The driver's spot is saved on the order (for GET /orders/:id after a reload) at most this often; the room relays every fix. */
const ORDER_LOC_SAVE_MS = 30_000;

function send(ws: WebSocket, msg: Message) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket closing
  }
}

/**
 * The live pickup job board (one instance, "all"): drivers online for pickup get the pending jobs on connect and
 * again whenever one is placed, taken, released or cancelled. Replaces polling /jobs/available.
 */
export class PickupBoard extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /** Socket upgrade. routes/ws.ts has already checked the ticket and that the driver is online for pickup. */
  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    send(server, await this.jobs());
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The pending jobs changed: send everyone the new list. */
  async refresh() {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const msg = await this.jobs();
    for (const ws of sockets) send(ws, msg);
  }

  private async jobs(): Promise<Message> {
    const pending = await listOrders(this.env.DB, "o.status = 'pending' ORDER BY o.id");
    return { t: 'jobs', jobs: pending.map(hidePhone) };
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
  }
}

type Attachment = { role: 'customer' | 'driver'; ts?: number };
/** Food orders waiting for Done Pay: when to remind the owner, and when to accept the payment for them. */
type PaymentTimers = { remindAt?: number; reminded?: number; confirmAt?: number };

/**
 * One pickup order (named "order-<id>"), from Send proof of payment (food) or creation (laundry) until delivered or
 * cancelled. The customer and the assigned driver get `{t:'order'}` on every status change; the driver sends `{t:'loc'}`
 * while carrying the order, which is relayed to the customer. While a food order waits for Done Pay, alarms remind the
 * owner every PAYMENT_REMINDER_MS (PAYMENT_REMINDERS times) and accept the payment after PAYMENT_AUTO_CONFIRM_MS. Closes everyone when it ends.
 */
export class OrderRoom extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  /** Socket upgrade. routes/ws.ts has already checked the ticket and that the user is on this order. */
  async fetch(request: Request): Promise<Response> {
    const role = request.headers.get('x-role') === 'driver' ? 'driver' : 'customer';
    await this.ctx.storage.put('orderId', Number(request.headers.get('x-order-id')));
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role } satisfies Attachment);
    const loc = await this.ctx.storage.get<LatLng>('loc');
    if (role === 'customer' && loc) send(server, { t: 'loc', ...loc });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A food order is waiting for Done Pay: start the owner reminder and the auto-accept. */
  async awaitPayment(orderId: number) {
    const now = Date.now();
    await this.ctx.storage.put({ orderId, status: 'awaiting_payment', payment: { remindAt: now + PAYMENT_REMINDER_MS, reminded: 0, confirmAt: now + PAYMENT_AUTO_CONFIRM_MS } });
    await this.ctx.storage.setAlarm(now + PAYMENT_REMINDER_MS);
  }

  /** The order changed (payment confirmed, placed, accepted, picked up, released, delivered, cancelled). */
  async update(orderId: number) {
    const order = await getOrder(this.env.DB, orderId);
    if (!order) return;
    await this.ctx.storage.put('status', order.status);
    if (order.status !== 'awaiting_payment') await this.stopPaymentTimers();
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) send(ws, { t: 'order', order });
    if (order.status === 'delivered' || order.status === 'cancelled') {
      for (const ws of sockets) ws.close(1000, 'order ended');
      await this.ctx.storage.deleteAll();
    }
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
    if ((await this.status()) !== 'picked_up') return;
    // Saved on the order too (throttled), so the map has the driver's spot after a reload.
    const savedAt = (await this.ctx.storage.get<number>('locSavedAt')) ?? 0;
    if (now - savedAt >= ORDER_LOC_SAVE_MS) {
      await this.env.DB.prepare("UPDATE orders SET driver_lat = ?, driver_lng = ?, driver_loc_at = datetime('now') WHERE id = ?")
        .bind(loc.lat, loc.lng, await this.ctx.storage.get<number>('orderId'))
        .run();
      await this.ctx.storage.put('locSavedAt', now);
    }
    await this.ctx.storage.put('loc', loc);
    for (const customer of this.ctx.getWebSockets('customer')) send(customer, { t: 'loc', ...loc });
  }

  async alarm() {
    const timers = (await this.ctx.storage.get<PaymentTimers>('payment')) ?? {};
    const now = Date.now();
    const orderId = await this.ctx.storage.get<number>('orderId');
    if (orderId === undefined) return;
    if (timers.confirmAt !== undefined && timers.confirmAt <= now) {
      await this.stopPaymentTimers();
      await this.autoConfirm(orderId);
      return;
    }
    if (timers.remindAt !== undefined && timers.remindAt <= now) {
      const reminded = (timers.reminded ?? 0) + 1;
      const remindAt = reminded < PAYMENT_REMINDERS ? timers.remindAt + PAYMENT_REMINDER_MS : undefined;
      await this.ctx.storage.put('payment', { remindAt, reminded, confirmAt: timers.confirmAt } satisfies PaymentTimers);
      const next = Math.min(remindAt ?? Infinity, timers.confirmAt ?? Infinity);
      if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
      await this.remindOwner(orderId);
    }
  }

  private async stopPaymentTimers() {
    if (!(await this.ctx.storage.get('payment'))) return;
    await this.ctx.storage.delete('payment');
    await this.ctx.storage.deleteAlarm();
  }

  /** Still awaiting_payment (the owner hasn't tapped Done Pay or the customer cancelled): nudge the owner. */
  private async remindOwner(orderId: number) {
    const row = await this.env.DB.prepare(
      "SELECT s.owner_id FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = ? AND o.status = 'awaiting_payment'",
    )
      .bind(orderId)
      .first<{ owner_id: number | null }>();
    if (!row?.owner_id) return;
    await pushToUsers(
      this.env.DB,
      [row.owner_id],
      'Review Payment Now',
      'A customer is waiting for you to review their payment. Check Orders and tap Done Pay.',
      { order_id: orderId },
      'ownerOrder',
    );
  }

  /** No Done Pay in time: accept the payment as the owner would, guarded so a tap or cancel that won keeps its result. */
  private async autoConfirm(orderId: number) {
    const { meta } = await this.env.DB.prepare(
      "UPDATE orders SET status = 'payment_confirmed', updated_at = datetime('now') WHERE id = ? AND status = 'awaiting_payment'",
    )
      .bind(orderId)
      .run();
    if (meta.changes === 0) return;
    const order = await getOrder(this.env.DB, orderId);
    if (!order) return;
    const owner = await this.env.DB.prepare('SELECT owner_id FROM stores WHERE id = ?').bind(order.store_id).first<{ owner_id: number | null }>();
    await Promise.all([
      pushToUsers(this.env.DB, [order.customer_id], 'Payment confirmed', `${order.store_name} accepted your payment. Place your order now.`, { order_id: orderId }),
      owner?.owner_id
        ? pushToUsers(
            this.env.DB,
            [owner.owner_id],
            'Payment accepted automatically',
            'An order was accepted after 10 reminders without Done Pay. Check the payment in Orders.',
            { order_id: orderId },
            'ownerOrder',
          )
        : undefined,
    ]);
    await this.update(orderId);
  }

  /** Order status as of the last update(); rooms opened before status was stored read it from D1 once. */
  private async status() {
    const cached = await this.ctx.storage.get<string>('status');
    if (cached) return cached;
    const row = await this.env.DB.prepare('SELECT status FROM orders WHERE id = ?')
      .bind(await this.ctx.storage.get<number>('orderId'))
      .first<{ status: string }>();
    if (row) await this.ctx.storage.put('status', row.status);
    return row?.status;
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
  }
}
