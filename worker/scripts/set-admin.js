#!/usr/bin/env node
// Developer only: gives a user cpanel access (users.is_admin = 1), or takes it away with --off.
// Usage: bun run admin:set <userId|email> [--off] [--remote]
// Without --remote it updates the local D1 database used by `bun run dev`.
import { d1, usageError } from './lib/mock.js';

const usage = usageError('bun run admin:set <userId|email> [--off] [--remote]');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const off = args.includes('--off');
const unknown = args.filter((a) => a.startsWith('--') && a !== '--remote' && a !== '--off');
if (unknown.length > 0) usage(`Unknown option ${unknown[0]}`);
const who = args.filter((a) => !a.startsWith('--'));
if (who.length !== 1) usage('Pass one user id or email');

// d1 execute has no bound parameters: ids are validated, emails are quoted with '' escaping.
const where = /^\d+$/.test(who[0]) ? `id = ${Number(who[0])}` : `email = '${who[0].toLowerCase().replaceAll("'", "''")}'`;
const [user] = d1(`SELECT id, email, role FROM users WHERE ${where}`, remote);
if (!user) usage(`No user ${who[0]}`);

d1(`UPDATE users SET is_admin = ${off ? 0 : 1} WHERE id = ${user.id}`, remote);
console.log(`User #${user.id} ${user.email} (${user.role}) ${off ? 'no longer has' : 'now has'} cpanel access.`);
