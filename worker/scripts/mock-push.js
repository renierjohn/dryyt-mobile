#!/usr/bin/env node
// Sends a test push notification to a user's phone, shaped exactly like the worker's pushes.
// Usage: yarn mock:push <userId|email> [preset] [--title <text>] [--body <text>] [--remote]
// Presets mirror the app's real pushes: new-dropoff (driver), arrived / waiting (owner),
// received / cancelled (customer). Default: a plain "Test notification".
// The user needs a saved push token: sign in once on a development or release build (not Expo Go).
import { d1, usageError } from './lib/mock.js';

const PRESETS = {
  test: { title: 'Test notification', body: 'Push from yarn mock:push.' },
  // Same channel and Dryyt chime as the worker's real new drop off push (PUSH_STYLES.newDropoff).
  'new-dropoff': { title: 'New drop off nearby', body: 'Fresh Fold Laundry: open Dryyt to accept.', channelId: 'new-dropoff', sound: 'dryyt.wav' },
  arrived: { title: 'New drop off', body: "Mock Customer's laundry has arrived." },
  waiting: { title: 'Drop off waiting', body: 'A laundry drop off is waiting for your confirmation.' },
  received: { title: 'Laundry received', body: 'The shop confirmed your drop off. Check your summary.' },
  cancelled: { title: 'Drop off cancelled', body: 'Your driver cancelled the trip.' },
};

const usage = usageError(`yarn mock:push <userId|email> [${Object.keys(PRESETS).join('|')}] [--title <text>] [--body <text>] [--remote]`);

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const opts = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--remote') continue;
  if (a === '--title' || a === '--body') {
    const value = args[++i];
    if (value === undefined) usage(`${a} needs a value`);
    opts[a.slice(2)] = value;
  } else if (a.startsWith('--')) usage(`Unknown option ${a}`);
  else positional.push(a);
}
const [who, presetName = 'test'] = positional;
if (!who) usage('Pass a user id or email');
const preset = PRESETS[presetName];
if (!preset) usage(`Unknown preset ${presetName}`);

// Ids are validated integers; emails are quoted with '' escaping (d1 execute has no bound parameters).
const where = /^\d+$/.test(who) ? `id = ${Number(who)}` : `email = '${who.toLowerCase().replaceAll("'", "''")}'`;
const [user] = d1(`SELECT id, email, role, push_token FROM users WHERE ${where}`, remote);
if (!user) usage(`No user ${who}`);
if (!user.push_token?.startsWith('ExponentPushToken[')) {
  usage(`${user.email} (#${user.id}) has no push token yet. Sign in on a development or release build with notifications allowed.`);
}

const message = {
  to: user.push_token,
  title: opts.title ?? preset.title,
  body: opts.body ?? preset.body,
  data: { mock: true },
  priority: 'high',
  channelId: preset.channelId ?? 'default',
  sound: preset.sound ?? 'default',
};
const res = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(message),
});
const result = (await res.json().catch(() => ({}))).data;
const ticket = Array.isArray(result) ? result[0] : result;

if (ticket?.status === 'ok') {
  console.log(`Sent "${message.title}" to ${user.email} (#${user.id}, ${user.role}). Ticket ${ticket.id}`);
} else {
  console.error(`Expo rejected the push (${res.status}): ${ticket?.message ?? JSON.stringify(result ?? {})}`);
  if (ticket?.details?.error === 'DeviceNotRegistered') console.error('The token is stale: sign in again on the phone to refresh it.');
  process.exit(1);
}
