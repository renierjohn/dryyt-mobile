#!/usr/bin/env node
// Updates a store's details. Set only the fields you pass.
// Usage: yarn shop:set <storeId> [--lat <lat> --lng <lng>] [--address <text>] [--type food|laundry]
//                                [--name <text>] [--owner <userId>|none] [--remote]
// Without --remote it updates the local D1 database used by `yarn dev`.
import { d1, usageError } from './lib/mock.js';

const USAGE = 'yarn shop:set <storeId> [--lat <lat> --lng <lng>] [--address <text>] [--type food|laundry] [--name <text>] [--owner <userId>|none] [--remote]';
const usage = usageError(USAGE);

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const opts = {};
let id;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--remote') continue;
  if (a.startsWith('--')) {
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) usage(`${a} needs a value`);
    opts[a.slice(2)] = value;
  } else if (id === undefined) id = Number(a);
  else usage(`Unexpected argument: ${a}`);
}

const known = ['lat', 'lng', 'address', 'type', 'name', 'owner'];
for (const key of Object.keys(opts)) if (!known.includes(key)) usage(`Unknown option --${key}`);
if (!Number.isInteger(id) || id <= 0) usage('storeId must be a positive integer');
if (Object.keys(opts).length === 0) usage('Pass at least one field to set');

// d1 execute has no bound parameters: numbers are validated, text is quoted with '' escaping.
const text = (s) => `'${s.replaceAll("'", "''")}'`;
const sets = [];

if ('lat' in opts || 'lng' in opts) {
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  if (!('lat' in opts && 'lng' in opts)) usage('Pass --lat and --lng together');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) usage('lat must be between -90 and 90');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) usage('lng must be between -180 and 180');
  sets.push(`lat = ${lat}`, `lng = ${lng}`);
}
if ('address' in opts) {
  if (!opts.address.trim()) usage('address cannot be empty');
  sets.push(`address = ${text(opts.address.trim())}`);
}
if ('name' in opts) {
  if (!opts.name.trim()) usage('name cannot be empty');
  sets.push(`name = ${text(opts.name.trim())}`);
}
if ('type' in opts) {
  if (opts.type !== 'food' && opts.type !== 'laundry') usage('type must be food or laundry');
  sets.push(`type = '${opts.type}'`);
}

const [shop] = d1(`SELECT id, name, type, address, lat, lng, owner_id FROM stores WHERE id = ${id}`, remote);
if (!shop) usage(`No store with id ${id}`);

if ('owner' in opts) {
  if (opts.owner === 'none') sets.push('owner_id = NULL');
  else {
    const ownerId = Number(opts.owner);
    if (!Number.isInteger(ownerId) || ownerId <= 0) usage('owner must be a user id or "none"');
    const [user] = d1(`SELECT id, role FROM users WHERE id = ${ownerId}`, remote);
    if (!user) usage(`No user with id ${ownerId}`);
    if (user.role !== 'owner') usage(`User #${ownerId} is a ${user.role}, not an owner`);
    sets.push(`owner_id = ${ownerId}`);
  }
}

d1(`UPDATE stores SET ${sets.join(', ')} WHERE id = ${id}`, remote);
const [after] = d1(`SELECT id, name, type, address, lat, lng, owner_id FROM stores WHERE id = ${id}`, remote);
console.log(`Store #${id} [${remote ? 'remote' : 'local'}]`);
console.table({ before: shop, after });
