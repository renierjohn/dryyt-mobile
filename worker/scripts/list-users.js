#!/usr/bin/env node
// Lists users with their role and, for drivers, online/busy state. Never prints password hashes.
// Usage: bun run users [customer|driver|owner] [--remote]
// Without --remote it reads the local D1 database used by `bun run dev`.
import { execFileSync } from 'node:child_process';

const ROLES = ['customer', 'driver', 'owner'];
const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [role] = args.filter((a) => a !== '--remote');

if (role !== undefined && !ROLES.includes(role)) {
  console.error('role must be customer, driver or owner\nUsage: bun run users [customer|driver|owner] [--remote]');
  process.exit(1);
}

// role is checked against a fixed list above, so it's safe to inline.
const sql = `SELECT u.id, u.email, u.name, u.phone, u.role, d.online, d.busy, d.group_id, u.push_token IS NOT NULL AS push, u.created_at
  FROM users u LEFT JOIN drivers d ON d.user_id = u.id${role ? ` WHERE u.role = '${role}'` : ''} ORDER BY u.id`;
const users = JSON.parse(
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'dryyt-mobile', remote ? '--remote' : '--local', '--json', '--command', sql], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  }),
)[0].results;

console.table(users);
