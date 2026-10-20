import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import { configDefaults } from 'vitest/config';

type Options = { include?: string[]; exclude?: string[]; isolatedStorage: boolean };

/**
 * Fake outbound services for tests: OSRM answers 3.2 km (500 when the start longitude is 0, no route when it is 1,
 * 403 without a User-Agent like the real server); OpenRouteService answers 2.85 km (500 when the start longitude is 0);
 * Expo push accepts all, except: `ExponentPushToken[gone]` gets a DeviceNotRegistered ticket, `ExponentPushToken[bad]`
 * a MessageTooBig ticket, and a batch with `ExponentPushToken[flaky]` answers 503 on every other request. Receipts:
 * ids starting `gone-` are DeviceNotRegistered, `pending-` have none yet, the rest are ok.
 */
let flakyPushRequests = 0;
async function outboundService(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === 'router.project-osrm.org') {
    if (!request.headers.get('user-agent')) return new Response('Forbidden', { status: 403 });
    const startLng = Number(url.pathname.split('/').pop()!.split(',')[0]);
    if (startLng === 0) return Response.json({ code: 'Error' }, { status: 500 });
    if (startLng === 1) return Response.json({ code: 'NoRoute', routes: [] });
    return Response.json({ code: 'Ok', routes: [{ distance: 3200, duration: 600 }] });
  }
  if (url.hostname === 'api.openrouteservice.org') {
    const { coordinates } = (await request.json()) as { coordinates: number[][] };
    if (coordinates[0][0] === 0) return Response.json({ error: 'down' }, { status: 500 });
    return Response.json({ routes: [{ summary: { distance: 2850, duration: 211 } }] });
  }
  if (url.hostname === 'exp.host' && url.pathname.endsWith('/getReceipts')) {
    const { ids } = (await request.json()) as { ids: string[] };
    const receipts = ids
      .filter((id) => !id.startsWith('pending-'))
      .map((id) => [id, id.startsWith('gone-') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }]);
    return Response.json({ data: Object.fromEntries(receipts) });
  }
  if (url.hostname === 'exp.host') {
    const messages = (await request.json()) as { to: string }[];
    if (messages.some((m) => m.to === 'ExponentPushToken[flaky]') && flakyPushRequests++ % 2 === 0) {
      return new Response('Unavailable', { status: 503 });
    }
    const error = (code: string) => ({ status: 'error', message: code, details: { error: code } });
    return Response.json({
      data: messages.map((m, i) =>
        m.to === 'ExponentPushToken[gone]' ? error('DeviceNotRegistered') : m.to === 'ExponentPushToken[bad]' ? error('MessageTooBig') : { status: 'ok', id: `ticket-${crypto.randomUUID()}` },
      ),
    });
  }
  return new Response('Blocked in tests', { status: 599 });
}

export function workersConfig({ include, exclude = [], isolatedStorage }: Options) {
  return defineWorkersConfig(async () => {
    const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
    return {
      test: {
        ...(include ? { include } : {}),
        exclude: [...configDefaults.exclude, ...exclude],
        setupFiles: ['./test/apply-migrations.ts'],
        poolOptions: {
          workers: {
            singleWorker: true,
            isolatedStorage,
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // Pickup may be off in wrangler.jsonc; the suites still cover it (the off switch has its own test).
              bindings: { TEST_MIGRATIONS: migrations, JWT_SECRET: 'test-secret', ORS_API_KEY: 'test-ors-key', PICKUP_ENABLED: 'true', TURNSTILE_SECRET: 'test-turnstile-secret', TURNSTILE_HOSTNAMES: 'dryyt.com' },
              outboundService,
            },
          },
        },
      },
    };
  });
}
