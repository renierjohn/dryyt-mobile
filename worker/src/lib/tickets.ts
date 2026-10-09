import type { AuthUser, Role } from '../types';

const TICKET_TTL_MS = 60_000;

/** Single-use, 60 s ticket so the JWT never appears in a WebSocket URL. */
export async function issueTicket(db: D1Database, user: AuthUser, room: string) {
  const token = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM ws_tickets WHERE expires_at <= ?').bind(now),
    db
      .prepare('INSERT INTO ws_tickets (token, user_id, role, room, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(token, user.id, user.role, room, now + TICKET_TTL_MS),
  ]);
  return token;
}

export function consumeTicket(db: D1Database, token: string, room: string, now = Date.now()) {
  return db
    .prepare('DELETE FROM ws_tickets WHERE token = ? AND room = ? AND expires_at > ? RETURNING user_id, role')
    .bind(token, room, now)
    .first<{ user_id: number; role: Role }>();
}
