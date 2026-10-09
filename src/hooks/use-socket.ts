import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api, wsUrl } from '@/lib/api';

export type SocketMessage = { t: string; [key: string]: any };

const BACKOFF_MS = [1000, 2000, 5000, 10000];
/** Trip rooms count a customer as gone after 5 min without this or a connection (worker CUSTOMER_OFFLINE_MS). */
const HEARTBEAT_MS = 10_000;

/**
 * Joins `room` ('dispatch' or a trip room id) with a fresh ticket per attempt; reconnects with backoff. `null` = stay closed.
 * `onOpen(send)` runs on every (re)connect, e.g. to resend the latest location.
 * The dispatch socket closes while the app is in the background, so Dispatch sees the driver as gone and pushes them
 * instead, and reopens at once on return. Trip sockets stay open: the customer's 5 min grace covers short absences.
 */
export function useSocket(
  room: string | null,
  onMessage: (msg: SocketMessage) => void,
  onOpen?: (send: (msg: SocketMessage) => void) => void,
) {
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  const openHandler = useRef(onOpen);

  useEffect(() => {
    handler.current = onMessage;
    openHandler.current = onOpen;
  });

  useEffect(() => {
    if (!room) return;
    const closeInBackground = room === 'dispatch';
    let closed = false;
    let paused = closeInBackground && AppState.currentState === 'background';
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const retry = () => {
      if (closed || paused) return;
      timer = setTimeout(open, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      attempt += 1;
    };

    const disconnect = () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      socket.current?.close();
      socket.current = null;
      setConnected(false);
    };

    async function open() {
      try {
        const { ticket } = await api<{ ticket: string }>('/ws/ticket', { body: { room } });
        if (closed || paused) return;
        const path = room === 'dispatch' ? '/ws/dispatch' : `/ws/trip/${room}`;
        const ws = new WebSocket(wsUrl(`${path}?ticket=${ticket}`));
        socket.current = ws;
        ws.onopen = () => {
          attempt = 0;
          setConnected(true);
          // Trip rooms answer pings without waking up; a missing heartbeat tells the driver we're gone.
          if (room !== 'dispatch') heartbeat = setInterval(() => ws.send(JSON.stringify({ t: 'ping' })), HEARTBEAT_MS);
          openHandler.current?.((msg) => ws.send(JSON.stringify(msg)));
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(String(e.data));
            if (msg.t !== 'pong') handler.current(msg);
          } catch {
            // ignore malformed messages
          }
        };
        ws.onclose = () => {
          // Closed by disconnect() (background or unmount): already cleaned up, and must not reconnect.
          if (socket.current !== ws) return;
          clearInterval(heartbeat);
          socket.current = null;
          setConnected(false);
          retry();
        };
      } catch {
        retry();
      }
    }

    const appState = closeInBackground
      ? AppState.addEventListener('change', (state) => {
          if (state === 'background' && !paused) {
            paused = true;
            disconnect();
          } else if (state === 'active' && paused) {
            paused = false;
            attempt = 0;
            open();
          }
        })
      : null;

    if (!paused) open();
    return () => {
      closed = true;
      appState?.remove();
      disconnect();
    };
  }, [room]);

  const send = useCallback((msg: SocketMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  }, []);

  return { connected, send };
}
