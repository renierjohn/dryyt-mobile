#!/usr/bin/env node
// Runs `wrangler dev` on 0.0.0.0:9999 as the host the app calls (EXPO_PUBLIC_API_URL in the app's .env).
// Without --local-upstream, wrangler dev rewrites every request to the first route (dryyt.com), so image URLs the
// worker builds from the request (logos, payment QRs, menu photos) would point at production instead of this server.
// Usage: bun run dev [-- <more wrangler dev flags>]
import { spawn } from 'node:child_process';

import { appApiUrl } from './lib/mock.js';

const { host } = new URL(appApiUrl());
const args = ['wrangler', 'dev', '--ip', '0.0.0.0', '--port', '9999', '--local-upstream', host, ...process.argv.slice(2)];
console.log(`wrangler dev as ${host}`);
spawn('npx', args, { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
