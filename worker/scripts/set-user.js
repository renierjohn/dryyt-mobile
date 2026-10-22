#!/usr/bin/env node
// Updates a user's details. Set only the fields you pass.
// Usage: bun run user:set <userId|email> [--name <text>] [--email <email>] [--phone <text>] [--password <text>]
//                                     [--online true|false] [--busy true|false] [--group <group_id>]
//                                     [--push <ExponentPushToken[...]>|none] [--remote]
// --online, --busy and --group are for drivers only. Without --remote it updates the local D1 database.
import { d1, hashPassword, usageError } from './lib/mock.js';

const usage = usageError(
  'bun run user:set <userId|email> [--name <text>] [--email <email>] [--phone <text>] [--password <text>] [--online true|false] [--busy true|false] [--group <group_id>] [--push <token>|none] [--remote]',
);

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const opts = {};
let who;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--remote') continue;
  if (a.startsWith('--')) {
    const value = args[++i];
    if (value === undefined) usage(`${a} needs a value`);
    opts[a.slice(2)] = value;
  } else if (who === undefined) who = a;
  else usage(`Unexpected argument: ${a}`);
}

const known = ['name', 'email', 'phone', 'password', 'online', 'busy', 'group', 'push'];
for (const key of Object.keys(opts)) if (!known.includes(key)) usage(`Unknown option --${key}`);
if (!who) usage('Pass a user id or email');
if (Object.keys(opts).length === 0) usage('Pass at least one field to set');

// d1 execute has no bound parameters: numbers are validated, text is quoted with '' escaping.
const text = (s) => `'${s.replaceAll("'", "''")}'`;
const bool = (key) => {
  if (opts[key] !== 'true' && opts[key] !== 'false') usage(`--${key} must be true or false`);
  return opts[key] === 'true' ? 1 : 0;
};

const where = /^\d+$/.test(who) ? `id = ${Number(who)}` : `email = ${text(who.toLowerCase())}`;
const [user] = d1(`SELECT id, email, name, phone, role, push_token IS NOT NULL AS push FROM users WHERE ${where}`, remote);
if (!user) usage(`No user ${who}`);

const userSets = [];
const driverSets = [];

if ('name' in opts) {
  if (!opts.name.trim()) usage('name cannot be empty');
  userSets.push(`name = ${text(opts.name.trim())}`);
}
if ('email' in opts) {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage('Enter a valid email');
  const [taken] = d1(`SELECT id FROM users WHERE email = ${text(email)} AND id != ${user.id}`, remote);
  if (taken) usage(`${email} is already used by user #${taken.id}`);
  userSets.push(`email = ${text(email)}`);
}
if ('phone' in opts) {
  if (opts.phone.trim().length < 7) usage('phone must be at least 7 characters');
  userSets.push(`phone = ${text(opts.phone.trim())}`);
}
if ('password' in opts) {
  if (opts.password.length < 8) usage('password must be at least 8 characters');
  userSets.push(`password_hash = ${text(await hashPassword(opts.password))}`);
}
if ('push' in opts) {
  if (opts.push === 'none') userSets.push('push_token = NULL');
  else if (opts.push.startsWith('ExponentPushToken[') && opts.push.length <= 200) userSets.push(`push_token = ${text(opts.push)}`);
  else usage('push must be an ExponentPushToken[...] or "none"');
}
if ('online' in opts || 'busy' in opts || 'group' in opts) {
  if (user.role !== 'driver') usage(`--online, --busy and --group are for drivers; user #${user.id} is ${user.role === 'owner' ? 'an' : 'a'} ${user.role}`);
  if ('online' in opts) driverSets.push(`online = ${bool('online')}`);
  if ('busy' in opts) driverSets.push(`busy = ${bool('busy')}`);
  if ('group' in opts) {
    if (!/^[\w-]{1,64}$/.test(opts.group)) usage('group must be letters, digits, _ or - (max 64)');
    driverSets.push(`group_id = ${text(opts.group)}`);
  }
  driverSets.push("updated_at = datetime('now')");
}

const driverRow = () =>
  user.role === 'driver' ? (d1(`SELECT online, busy, group_id FROM drivers WHERE user_id = ${user.id}`, remote)[0] ?? {}) : {};
const show = () => ({
  ...d1(`SELECT id, email, name, phone, role, push_token IS NOT NULL AS push FROM users WHERE id = ${user.id}`, remote)[0],
  ...driverRow(),
});

const before = { ...user, ...driverRow() };
if (userSets.length) d1(`UPDATE users SET ${userSets.join(', ')} WHERE id = ${user.id}`, remote);
if (driverSets.length) d1(`UPDATE drivers SET ${driverSets.join(', ')} WHERE user_id = ${user.id}`, remote);

console.log(`User #${user.id} [${remote ? 'remote' : 'local'}]${'password' in opts ? ' (password changed)' : ''}`);
console.table({ before, after: show() });

