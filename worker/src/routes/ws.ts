import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth } from '../lib/auth';
import { fail, parseBody } from '../lib/http';
import { dispatchAccess, dispatchFor, tripAccess, tripFor } from '../lib/rooms';
import { consumeTicket, issueTicket } from '../lib/tickets';
import type { AppEnv } from '../types';

const ticketSchema = z.object({ room: z.string().min(1).max(64) });

const ws = new Hono<AppEnv>();

ws.post('/ticket', requireAuth, async (c) => {
  const { room } = await parseBody(c, ticketSchema);
  const user = c.get('user');
  const allowed = room === 'dispatch' ? await dispatchAccess(c.env.DB, user) : await tripAccess(c.env.DB, user, room);
  if (!allowed) fail(403, 'You cannot join this room');
  return c.json({ ticket: await issueTicket(c.env.DB, user, room) });
});

ws.get('/dispatch', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') fail(426, 'Expected a WebSocket upgrade');
  const ticket = await consumeTicket(c.env.DB, c.req.query('ticket') ?? '', 'dispatch');
  if (!ticket) fail(401, 'Invalid or expired ticket');

  const user = { id: ticket.user_id, role: ticket.role };
  const access = await dispatchAccess(c.env.DB, user);
  if (!access) fail(403, 'You cannot join this room');

  const headers = new Headers({ upgrade: 'websocket', 'x-user-id': String(user.id), 'x-role': user.role });
  if (access.transactionId) headers.set('x-transaction-id', String(access.transactionId));
  return dispatchFor(c.env, access.group).fetch('https://dispatch/connect', { headers });
});

ws.get('/trip/:room', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') fail(426, 'Expected a WebSocket upgrade');
  const room = c.req.param('room');
  const ticket = await consumeTicket(c.env.DB, c.req.query('ticket') ?? '', room);
  if (!ticket) fail(401, 'Invalid or expired ticket');

  const user = { id: ticket.user_id, role: ticket.role };
  if (!(await tripAccess(c.env.DB, user, room))) fail(403, 'You cannot join this room');

  const headers = new Headers({ upgrade: 'websocket', 'x-user-id': String(user.id), 'x-role': user.role });
  return tripFor(c.env, room).fetch('https://trip/connect', { headers });
});

export default ws;
