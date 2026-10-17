#!/usr/bin/env node
// Lists stores with their type, owner and map pin.
// Usage: bun run stores [food|laundry] [--remote]
// Without --remote it reads the local D1 database used by `bun run dev`.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [type] = args.filter((a) => a !== '--remote');

if (type !== undefined && type !== 'food' && type !== 'laundry') {
  console.error('type must be food or laundry\nUsage: bun run stores [food|laundry] [--remote]');
  process.exit(1);
}

// type is checked against a fixed list above, so it's safe to inline.
const sql = `SELECT id, name, type, address, lat, lng, owner_id FROM stores${type ? ` WHERE type = '${type}'` : ''} ORDER BY id`;
const stores = JSON.parse(
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'dryyt', remote ? '--remote' : '--local', '--json', '--command', sql], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  }),
)[0].results;

console.table(stores);
