// Live mirror of a text file (default: debug.txt) over HTTP, like `tail -f` in the browser.
// Usage: bun run serve:debug [file] [port]   (defaults: debug.txt, 8090)
// Open the printed URL on any device on the same network.
const { closeSync, existsSync, openSync, readSync, statSync, watchFile } = require('node:fs');
const { networkInterfaces } = require('node:os');
const { resolve } = require('node:path');

const FILE = resolve(process.argv[2] ?? 'debug.txt');
const PORT = Number(process.argv[3] ?? process.env.PORT ?? 8090);
const INITIAL_TAIL_BYTES = 512 * 1024; // history sent to newly connected clients
const POLL_MS = 250;

const encoder = new TextEncoder();
const clients = new Set();
let offset = 0;
let decoder = new TextDecoder();

function readRange(start, end) {
  if (end <= start) return new Uint8Array(0);
  const buf = Buffer.alloc(end - start);
  const fd = openSync(FILE, 'r');
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  return buf;
}

const size = () => (existsSync(FILE) ? statSync(FILE).size : 0);

function snapshot() {
  const end = size();
  const start = Math.max(0, end - INITIAL_TAIL_BYTES);
  let text = new TextDecoder().decode(readRange(start, end));
  if (start > 0) text = `… (showing last ${INITIAL_TAIL_BYTES / 1024} KB)\n` + text.slice(text.indexOf('\n') + 1);
  return text;
}

function send(controller, event, data) {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  } catch {
    clients.delete(controller);
  }
}
const broadcast = (event, data) => clients.forEach((c) => send(c, event, data));

function onChange() {
  const end = size();
  if (end < offset) {
    // Truncated or replaced: resend everything.
    offset = end;
    decoder = new TextDecoder();
    broadcast('reset', snapshot());
    return;
  }
  if (end === offset) return;
  const chunk = decoder.decode(readRange(offset, end), { stream: true });
  offset = end;
  if (chunk) broadcast('append', chunk);
}

offset = size();
watchFile(FILE, { interval: POLL_MS }, onChange); // polling: works on Windows/macOS/Linux and before the file exists
setInterval(() => clients.forEach((c) => {
  try { c.enqueue(encoder.encode(': ping\n\n')); } catch { clients.delete(c); }
}), 15000);

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>debug.txt live</title>
<style>
:root{--bg:#fff;--fg:#111;--muted:#666;--bar:#f3f3f3}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#ddd;--muted:#999;--bar:#1c1c1c}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui}
header{position:sticky;top:0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 16px;background:var(--bar)}
#status{color:var(--muted);font-size:12px}
pre{margin:0;padding:12px 16px;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
</style></head><body>
<header><strong>${FILE.replace(/[&<>]/g, '')}</strong><span id="status">connecting…</span>
<label><input type="checkbox" id="follow" checked> auto-scroll</label>
<button id="clear">clear view</button></header>
<pre id="out"></pre>
<script>
const out = document.getElementById('out'), status = document.getElementById('status'), follow = document.getElementById('follow');
const scroll = () => { if (follow.checked) window.scrollTo(0, document.body.scrollHeight); };
document.getElementById('clear').onclick = () => { out.textContent = ''; };
const es = new EventSource('/events');
es.addEventListener('reset', (e) => { out.textContent = JSON.parse(e.data); scroll(); });
es.addEventListener('append', (e) => { out.append(JSON.parse(e.data)); scroll(); });
es.onopen = () => { status.textContent = 'live'; };
es.onerror = () => { status.textContent = 'reconnecting…'; };
</script></body></html>`;

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  idleTimeout: 0, // keep SSE connections open
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/') {
      return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (pathname === '/raw') {
      return new Response(existsSync(FILE) ? Bun.file(FILE) : '', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (pathname === '/events') {
      let self;
      const stream = new ReadableStream({
        start(controller) {
          self = controller;
          clients.add(controller);
          send(controller, 'reset', snapshot());
        },
        cancel() {
          clients.delete(self);
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => `http://${n.address}:${server.port}`);
console.log(`Mirroring ${FILE}${existsSync(FILE) ? '' : ' (not created yet — waiting)'}`);
console.log(`  local: http://localhost:${server.port}`);
lan.forEach((u) => console.log(`  LAN:   ${u}`));
console.log('Ctrl+C to stop.');
