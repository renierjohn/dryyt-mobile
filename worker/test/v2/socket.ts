import { SELF } from 'cloudflare:test';

import { api } from '../helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = { t: string; [key: string]: any };

const open: WebSocket[] = [];

/** Ticket + upgrade, then a queue of parsed messages. `next(t)` waits for the first queued message of that type. */
export async function openSocket(token: string, room: string) {
  const { body } = await api('/ws/ticket', { token, body: { room } });
  const path =
    room === 'dispatch' ? '/ws/dispatch' : room === 'pickups' ? '/ws/pickups' : room.startsWith('order-') ? `/ws/order/${room.slice(6)}` : `/ws/trip/${room}`;
  const res = await SELF.fetch(`https://api.test${path}?ticket=${body.ticket}`, { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`upgrade failed: ${res.status} ${await res.text()}`);
  ws.accept();
  open.push(ws);

  const queue: Msg[] = [];
  ws.addEventListener('message', (e) => {
    queue.push(JSON.parse(e.data as string));
  });

  return {
    send: (msg: Msg) => ws.send(JSON.stringify(msg)),
    async next(types: string | string[], tries = 200): Promise<Msg> {
      const wanted = Array.isArray(types) ? types : [types];
      for (let i = 0; i < tries; i++) {
        const at = queue.findIndex((m) => wanted.includes(m.t));
        if (at >= 0) return queue.splice(at, 1)[0];
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${wanted.join('/')} message; queue: ${JSON.stringify(queue)}`);
    },
    close: () => ws.close(),
  };
}

export function closeAll() {
  for (const ws of open.splice(0)) {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}
