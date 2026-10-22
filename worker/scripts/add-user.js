#!/usr/bin/env node
// Registers a user, like the app's sign up (POST /auth/register). Drivers also get their drivers row.
// Usage: bun run user:add <email> <password> --role customer|driver|owner --name <text> --phone <text> [--remote]
// Without --remote it adds to the local D1 database.
import { d1, hashPassword, usageError } from './lib/mock.js';

const usage = usageError('bun run user:add <email> <password> --role customer|driver|owner --name <text> --phone <text> [--remote]');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--remote') continue;
  if (a.startsWith('--')) {
    const value = args[++i];
    if (value === undefined) usage(`${a} needs a value`);
    opts[a.slice(2)] = value;
  } else positional.push(a);
}

for (const key of Object.keys(opts)) if (!['role', 'name', 'phone'].includes(key)) usage(`Unknown option --${key}`);
if (positional.length !== 2) usage('Pass an email and a password');

// Same rules as the worker's registerSchema.
const email = positional[0].trim().toLowerCase();
const password = positional[1];
const name = (opts.name ?? '').trim();
const phone = (opts.phone ?? '').trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage('Enter a valid email');
if (password.length < 8) usage('Password must be at least 8 characters');
if (!['customer', 'driver', 'owner'].includes(opts.role)) usage('--role must be customer, driver or owner');
if (!name) usage('--name is required');
if (phone.length < 7) usage('--phone must be at least 7 characters');

// d1 execute has no bound parameters: text is quoted with '' escaping.
const text = (s) => `'${s.replaceAll("'", "''")}'`;

const [taken] = d1(`SELECT id FROM users WHERE email = ${text(email)}`, remote);
if (taken) usage(`${email} is already registered (user #${taken.id})`);

const [user] = d1(
  `INSERT INTO users (email, password_hash, name, phone, role)
   VALUES (${text(email)}, ${text(await hashPassword(password))}, ${text(name)}, ${text(phone)}, ${text(opts.role)})
   RETURNING id, email, name, phone, role`,
  remote,
);
if (opts.role === 'driver') d1(`INSERT INTO drivers (user_id) VALUES (${user.id})`, remote);

console.log(`Added user #${user.id} [${remote ? 'remote' : 'local'}]`);
console.table([user]);
