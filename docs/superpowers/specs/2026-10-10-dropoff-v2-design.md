# Dryyt Drop off v2 — Real-time Design

Date: 2026-10-10
Source: Google Sheet "Dryyt Mobile APP Workflow" → "Dropoff Delivery Workflow".
Builds on: `2026-10-09-delivery-app-design.md` (v1). Pickup stays as in v1.

## Goal

Replace the v1 Drop off (text address, job board, flat fee) with a real-time flow:

- The customer searches for nearby drivers on a map.
- A driver accepts and the customer confirms.
- The customer tracks the driver live.
- The driver drops the laundry at the shop and records weight, laundry fee and a proof photo.
- The laundry shop **owner** confirms.
- Fees are distance-based, by road.

## Scope

**In:**
- Owner role
- GPS coordinates and maps
- WebSockets via Durable Objects
- Road distance via OpenRouteService
- Per-group rates
- Commission (service fee)
- Proof-of-delivery photo in R2
- Push notifications to drivers on Android
- Owner blocklist of drivers
- Payout records
- Timeouts

**Out:**
- iOS silent push
- Background location (the driver app must stay open while on a job)
- Online payment
- Admin UI (admin edits `rates`, `group_id`, and store owners by SQL)
- Ratings and chat

## Roles

- **customer**, **driver**: as in v1.
- **owner** (new): linked to one laundry store through `stores.owner_id`. The admin sets the link by SQL. An owner with no store sees "No shop linked".

## Fees

All money is integer centavos, rounded to the nearest centavo.

- `road_km` = road distance from customer to laundry shop (OpenRouteService, `driving-car`), computed once when the request is created.
- `delivery_fee` = `base_fee + road_km × rate_per_km`
- `service_fee` = `delivery_fee × commission_pct / 100` (commission to the app developer)
- `total_delivery_fee` = `delivery_fee + service_fee`
- `laundry_fee`: the owner tells the driver, who enters it at drop-off.
- Customer pays the owner `total_delivery_fee + laundry_fee`, online or in person, outside the app.
- Owner pays the driver `delivery_fee` and the developer `service_fee`, recorded in `payouts`.

Visibility:

| Field | Customer | Driver | Owner |
|---|---|---|---|
| `delivery_fee`, `service_fee` | hidden | shown | shown |
| `total_delivery_fee`, `laundry_fee` | shown | shown | shown |

## Status flow (`transactions.status`)

```
searching → driver_accepted → en_route_pickup → en_route_shop → dropped_off → owner_confirmed → completed
```

| From | To | Who / trigger |
|---|---|---|
| `searching` | `driver_accepted` | Driver accepts (first wins) |
| `searching` | `expired` | No accept within 3 min |
| `searching` | `cancelled` | Customer |
| `driver_accepted` | `en_route_pickup` | Customer confirms |
| `driver_accepted` | `searching` | Customer cancels the driver, or no confirm in 60 s. Driver is released. |
| `driver_accepted` | `cancelled` | Customer. Driver is released. |
| `en_route_pickup` | `cancelled` | Customer. Driver is released. |
| `en_route_pickup` | `en_route_shop` | Driver: "Picked up" |
| `en_route_shop` | `dropped_off` | Driver submits the drop-off form. Driver is released. |
| `dropped_off` | `owner_confirmed` | Owner confirms. Payouts are created. |
| `owner_confirmed` | `completed` | Customer or owner confirms payment |
| `owner_confirmed` | `payment_pending` | Owner: customer did not pay |
| `completed` | `payment_pending` | Owner: customer did not pay |
| `payment_pending` | `completed` | Customer or owner confirms payment |

A customer has at most one active drop off (`searching` … `en_route_shop`).

**Driver state** (`drivers.online`, `drivers.busy`): `online` is the driver's toggle; `busy` is set from `driver_accepted` until drop-off (and by v1 Pickup accept until delivered/released). Drivers without a location for 30 s are hidden from customers. Push goes to online, not-busy drivers with no live socket.

A driver holds at most one active job across v1 Pickup orders and Drop off transactions. v1 Pickup accept, release and deliver keep `drivers.busy` in sync.

## Timeouts

All timeouts are Durable Object alarms. Values are constants in `worker/src/lib/dropoff-config.ts`, defaults below.

| Status | Timeout | Effect |
|---|---|---|
| `searching` | 3 min | → `expired`; customer may search again |
| `driver_accepted` | 60 s | → `searching`; driver `busy` cleared |
| `en_route_*` | no driver location for 2 min | Warn the customer. Customer may cancel while `en_route_pickup`. |
| `dropped_off` | 30 min | Remind the owner by push |

## Architecture

| Piece | Responsibility |
|---|---|
| **D1** | Permanent record: users, stores, drivers, rates, transactions, owner_transactions, payouts, blocklist. |
| **Durable Object `Dispatch`**, one per `group_id` (default `"default"`) | Holds online drivers and searching customers. Keeps live driver locations in memory, matches nearby drivers, and serializes accepts. |
| **Durable Object `Trip`**, one per transaction (random room id) | 1:1 live tracking between customer and assigned driver. Runs the timeout alarms for its transaction. |
| **R2** | Proof-of-delivery photos. |
| **OpenRouteService** | Road distance. Behind one function `roadDistanceKm(from, to)` so OSRM can replace it by config. API key is the Worker secret `ORS_API_KEY`. |
| **Expo push** (Android/FCM) | Notifies online, not-busy drivers who aren't connected, and owners. |

Both Durable Objects use the WebSocket Hibernation API.

### Nearby matching (in `Dispatch`)

- **Grid index.** Index drivers by geohash precision 5 (cells about 5 km across).
- **Candidates.** For a customer, take drivers in the 7×7 block of cells around them. Keep the ones that are online and not busy, not blocklisted by the shop, and within 10 km straight-line (haversine).
- **Colour.** Green when ≤ 5 km, amber when 5–10 km.
- **Road distance.** Call OpenRouteService only for the fee (customer → shop), never per driver.

### Live location

- **Sending.** Drivers send `{lat, lng}` over their `Dispatch` connection every 5 s (later over `Trip`).
- **Rate limit.** Messages faster than 1 per 2 s are dropped.
- **Grid move.** Crossing into a new cell moves the driver in the index.
- **D1 writes.** Locations go to D1 only on status changes, not every update.
- **No HTTP endpoint.** Locations are not sent over HTTP.

### WebSocket auth

1. `POST /ws/ticket {room: 'dispatch' | <trip room id>}` returns a single-use ticket valid for 60 s, bound to the user and room.
2. The app connects to `/ws/dispatch?ticket=…` or `/ws/trip/<room_id>?ticket=…`.
3. The Durable Object checks the ticket.
   - `Trip` admits only that transaction's customer and assigned driver.
   - `Dispatch` admits drivers, and customers with a `searching` transaction.
4. Room ids are `crypto.randomUUID()`.

### Accept race

- **Serialized in `Dispatch`.** Accepts are handled one at a time.
- **First wins.** The first accept wins. Every other driver gets `taken`, and the request disappears from their list.
- **D1 backstop.** D1 also guards with conditional updates. 0 rows changed → reject.
  - `UPDATE transactions SET driver_id=?, status='driver_accepted' WHERE id=? AND status='searching'`
  - `UPDATE drivers SET busy = 1 WHERE user_id = ? AND busy = 0`

## Data model (migration `0003_dropoff_v2.sql`)

**`users.role`** adds `owner`. This needs a table rebuild because of the CHECK constraint.

**`users`** adds `push_token`.

**`stores`** adds:
- `owner_id` (nullable)
- `group_id` (default `'default'`)
- `lat`, `lng`

New tables:

| Table | Columns |
|---|---|
| `drivers` | user_id (PK), online, busy, group_id, lat, lng, updated_at |
| `rates` | id, group_id (unique), base_fee, rate_per_km, commission_pct |
| `transactions` | id, room_id (unique), customer_id, driver_id, store_id, status, customer_lat, customer_lng, customer_address, shop_lat, shop_lng, road_km, delivery_fee, service_fee, total_delivery_fee, laundry_fee, created_at, updated_at |
| `owner_transactions` | id, transaction_id (unique), store_id, weight_kg, laundry_fee, notes, proof_photo_key, status (`pending`\|`ok`), created_at, updated_at |
| `payouts` | id, transaction_id, payer_store_id, payee_type (`driver`\|`developer`), payee_id (null for developer), amount, status (`pending`\|`paid`), paid_at, created_at, UNIQUE(transaction_id, payee_type) |
| `driver_blocks` | store_id, driver_id, created_at, PK(store_id, driver_id) |
| `ws_tickets` | token (PK), user_id, role, room, expires_at |

Seed:
- `rates` default group: `base_fee 4000`, `rate_per_km` and `commission_pct` set by the admin (placeholder 1000 and 10).
- Coordinates for the two seeded laundry stores.

Indexes:
- `transactions(customer_id)`, `transactions(status)`
- A partial unique index on `transactions(driver_id)` for active statuses (`driver_accepted`, `en_route_pickup`, `en_route_shop`).

## API

Same style as v1: JWT bearer, `{error}` bodies, unprefixed paths.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/dropoffs` | customer | `{store_id, lat, lng, address}`. Computes road_km and fees, status `searching`. Returns transaction (customer view). |
| GET | `/dropoffs/:id` | customer, assigned driver, store owner | Role-filtered fee fields |
| GET | `/dropoffs` | customer | Own list |
| GET | `/drivers/me` | driver | `{driver:{online,busy}, job}` |
| POST | `/drivers/me/online` | driver | `{online}` |
| POST | `/dropoffs/:id/confirm-driver` | customer | `driver_accepted` → `en_route_pickup`. Returns `room_id`. |
| POST | `/dropoffs/:id/reject-driver` | customer | → `searching` |
| POST | `/dropoffs/:id/cancel` | customer | From `searching` or `en_route_pickup` |
| POST | `/dropoffs/:id/picked-up` | driver | → `en_route_shop` |
| POST | `/dropoffs/:id/proof-upload` | driver | Image body (≤ 5 MB, jpeg/png) → R2 key |
| POST | `/dropoffs/:id/drop` | driver | `{weight_kg, laundry_fee, notes, proof_photo_key}` → `dropped_off` |
| GET | `/owner/transactions?status=pending` | owner | Own store only; polled |
| POST | `/owner/transactions/:id/confirm` | owner | → `owner_confirmed`. Creates 2 payouts. |
| POST | `/dropoffs/:id/payment` | customer, owner | `{paid: true}` → `completed`; owner `{paid: false}` → `payment_pending` |
| GET | `/owner/payouts` | owner | List |
| POST | `/owner/payouts/:id/paid` | owner | Mark paid |
| POST | `/owner/blocks` | owner | `{driver_id, blocked: boolean}` blocklist |
| GET | `/dropoffs/:id/proof` | customer, owner, driver | Streams the R2 photo |
| POST | `/me/push-token` | any | Save Expo push token |
| POST | `/ws/ticket` | any | See WebSocket auth |

Accepting a job happens over the `Dispatch` socket, not HTTP.

### WebSocket messages

| Direction | Message |
|---|---|
| driver → Dispatch | `{t:'loc', lat, lng}`, `{t:'accept', transaction_id}` |
| Dispatch → driver | `{t:'requests', items:[…]}`, `{t:'taken', transaction_id}`, `{t:'accepted', transaction_id}` |
| customer → Dispatch | Subscribes with its `searching` transaction |
| Dispatch → customer | `{t:'drivers', items:[{lat, lng, colour}]}` (no identities), `{t:'driver_accepted', driver:{name, phone}, total_delivery_fee}`, `{t:'expired'}` |
| Trip | Driver `{t:'loc'}` → customer; `{t:'status', status}` → both |

## Mobile

**Prerequisites:**
- New libraries: `react-native-maps` (Google Maps on Android), `expo-location` (foreground only), `expo-notifications`, `expo-image-picker`.
- A development build is required for push. The Google Maps Android key goes in `app.json`.

**Customer:**
- Drop off flow:
  1. Choose laundry shop.
  2. Set a pin, defaulting to current location, plus a text address.
  3. Search screen: map with green/amber drivers.
  4. Driver-accepted sheet: name, phone, total delivery fee, Confirm / Cancel.
  5. Tracking screen: pins for customer, driver and shop.
- Summary screen:
  - Total delivery fee, laundry fee, grand total
  - Proof photo
  - "I've paid" button

**Driver:**
- "Go online" toggle, which opens the Dispatch socket.
- Request cards with distance colour and Accept.
- Trip map with "Picked up" and "Arrived" buttons.
- Drop-off form:
  - Weight
  - Laundry fee
  - Notes
  - Photo
- Waiting screen: "Pending owner confirmation".

**Owner** (new tab group):
- Pending drop-offs list, polled every 5 s.
- Detail and Confirm.
- Payment buttons: Paid / Not paid.
- Payouts list with "Mark paid".
- Block driver.

## Error handling

- Same status codes as v1.
- **OpenRouteService failure:** `POST /dropoffs` returns 503 "Can't calculate distance, try again"; no transaction is created.
- **Socket drop:** the app reconnects with a new ticket, backing off 1 s, 2 s, 5 s, then every 10 s.

## Testing

Vitest with pool-workers:
- Fee math, including rounding.
- Role-filtered fee visibility.
- Status transitions and invalid transitions (409).
- Accept race: 2 drivers accept, 1 wins.
- Blocklist excludes the driver.
- Ticket: single use, expired, wrong room, wrong user.
- `Trip` admits only its customer and driver.
- Timeouts via `runDurableObjectAlarm`.
- Payouts are created on owner confirm.
- OpenRouteService is mocked with `fetchMock`.

Mobile: `tsc`, `expo lint`, and a manual run on an Android development build.

## Open items (not blocking)

- Real `rate_per_km` and `commission_pct` values.
- `group_id` boundaries. The admin decides later; everything uses `default` until then.
