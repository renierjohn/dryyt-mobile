import { DurableObject } from 'cloudflare:workers';

import { LOCATION_MIN_INTERVAL_MS } from '../lib/dropoff-config';
import { getOrder, hidePhone, listOrders } from '../lib/orders';
import type { Bindings, LatLng } from '../types';

type Message = { t: string; [key: string]: unknown };

const PING = JSON.stringify({ t: 'ping' });
const PONG = JSON.stringify({ t: 'pong' });

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

/**
 * One placed pickup order (named "order-<id>"), from Place order until delivered or cancelled. The customer and the
 * assigned driver get `{t:'order'}` on every status change; the driver sends `{t:'loc'}` while carrying the order,
 * which is saved for the map and relayed to the customer. Closes everyone when the order ends.
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

  /** The order changed (accepted, picked up, released, delivered, cancelled). */
  async update(orderId: number) {
    const order = await getOrder(this.env.DB, orderId);
    if (!order) return;
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
    // Saved on the order too, so the map has the driver's spot after a reload.
    const { meta } = await this.env.DB.prepare(
      "UPDATE orders SET driver_lat = ?, driver_lng = ?, driver_loc_at = datetime('now') WHERE id = ? AND status = 'picked_up'",
    )
      .bind(loc.lat, loc.lng, await this.ctx.storage.get<number>('orderId'))
      .run();
    if (meta.changes === 0) return;
    await this.ctx.storage.put('loc', loc);
    for (const customer of this.ctx.getWebSockets('customer')) send(customer, { t: 'loc', ...loc });
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
  }
}
