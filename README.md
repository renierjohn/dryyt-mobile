# Dryyt

Delivery app for food/laundry **Pickup** and laundry **Drop off**. Customers book; drivers deliver.

## Run locally

Backend (Cloudflare Worker + D1):

```bash
cd worker
bun install
cp .dev.vars.example .dev.vars   # set JWT_SECRET
bun run db:migrate:local
bun run dev                      # http://localhost:8788
bun run test
```

App (Expo):

```bash
bun install
cp .env.example .env              # set EXPO_PUBLIC_API_URL for your simulator/device
bun run ios                      # or bun run android
```

## Deploy the worker

```bash
cd worker
npx wrangler d1 create dryyt      # paste database_id into wrangler.jsonc
npx wrangler secret put JWT_SECRET
bun run db:migrate:remote
bun run deploy
```

Then set `EXPO_PUBLIC_API_URL` to the deployed `*.workers.dev` URL.

## Drop off v2

Real-time Drop off (maps, live drivers, owner confirmation). Design: `docs/superpowers/specs/2026-10-10-dropoff-v2-design.md`.

1. **Road routing.** Distances use OSRM on OpenStreetMap data (no key). `OSRM_URL` in `worker/wrangler.jsonc` and `src/lib/road-route.ts` point at the public demo server, which is for light use only; point both at a self-hosted OSRM for production.
2. **R2 bucket.** Run once before deploying: `npx wrangler r2 bucket create dryyt-proofs`.
3. **Migrations.** Run `npm run db:migrate:local` (and `npm run db:migrate:remote` for production) to apply migration 0003.
4. **Link a shop owner.**
   ```bash
   npx wrangler d1 execute dryyt --local --command "UPDATE stores SET owner_id = <user id> WHERE id = <store id>"
   ```
5. **Rates.**
   ```bash
   npx wrangler d1 execute dryyt --local --command "UPDATE rates SET rate_per_km = <centavos>, commission_pct = <percent> WHERE group_id = 'default'"
   ```
6. **Android build.**
   - Maps use OpenStreetMap in a WebView (no API key).
   - Push needs a development build (`npx expo run:android` or EAS) with an EAS `projectId`.
   - Expo Go shows maps but skips push.
7. **Keep the app open.** Drivers must keep the app open while online or on a trip (foreground location only).
