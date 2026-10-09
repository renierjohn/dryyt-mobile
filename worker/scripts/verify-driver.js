#!/usr/bin/env node
// Developer only: marks a driver verified (status 1) so the app shows the badge and locks their photos and plate,
// or unverified with --off so the driver can change them again.
// Usage: yarn driver:verify <userId|email> [--off] [--remote]
// Without --remote it updates the local D1 database used by `yarn dev`.
import { d1, usageError } from './lib/mock.js';

const usage = usageError('yarn driver:verify <userId|email> [--off] [--remote]');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const off = args.includes('--off');
const unknown = args.filter((a) => a.startsWith('--') && a !== '--remote' && a !== '--off');
if (unknown.length > 0) usage(`Unknown option ${unknown[0]}`);
const who = args.filter((a) => !a.startsWith('--'));
if (who.length !== 1) usage('Pass one user id or email');

// d1 execute has no bound parameters: ids are validated, emails are quoted with '' escaping.
const where = /^\d+$/.test(who[0]) ? `u.id = ${Number(who[0])}` : `u.email = '${who[0].toLowerCase().replaceAll("'", "''")}'`;
const select = `SELECT u.id, u.email, u.name, u.role, dd.photo_face IS NOT NULL AS has_face, dd.photo_id IS NOT NULL AS has_id,
  dd.face_check, dd.notes, dd.status FROM users u LEFT JOIN driver_data dd ON dd.user_id = u.id WHERE ${where}`;

const [before] = d1(select, remote);
if (!before) usage(`No user ${who[0]}`);
if (before.role !== 'driver') usage(`User #${before.id} is a ${before.role}, not a driver`);
if (!off && (!before.has_face || !before.has_id)) console.warn('Warning: this driver has not uploaded both photos yet.');
if (!off && before.face_check === 'skipped') console.warn('Warning: the face photo skipped the live face check. Look at it closely before verifying.');

d1(
  `INSERT INTO driver_data (user_id, status) VALUES (${before.id}, ${off ? 0 : 1})
   ON CONFLICT (user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
  remote,
);
const [after] = d1(select, remote);
console.log(`Driver #${before.id} [${remote ? 'remote' : 'local'}] ${off ? 'unverified' : 'verified'}`);
console.table({ before, after });
