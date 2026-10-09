import type { LatLng } from '../types';
import { haversineKm } from './geo';

export class RoutingError extends Error {}

type RoutingEnv = { OSRM_URL: string; OSRM_USER_AGENT: string; ORS_URL: string; ORS_API_KEY?: string };

/** Each routing server gets this long; the public ones are often slow. */
const ROUTING_TIMEOUT_MS = 5_000;
/** Typical road distance over straight-line distance, for the last-resort estimate. */
const ROAD_FACTOR = 1.3;

const km2 = (meters: number) => Math.round(meters / 10) / 100;

/**
 * Road distance in km (2 decimals): OSRM, then OpenRouteService (when a key is set), then straight line × ROAD_FACTOR
 * so a drop off can always be booked. The only routing call site, so servers can be swapped later.
 */
export async function roadDistanceKm(env: RoutingEnv, from: LatLng, to: LatLng): Promise<number> {
  try {
    return await osrmKm(env, from, to);
  } catch (err) {
    console.warn('OSRM failed', String(err));
  }
  if (env.ORS_API_KEY) {
    try {
      return await orsKm(env, from, to);
    } catch (err) {
      console.warn('OpenRouteService failed', String(err));
    }
  }
  console.warn('road distance estimated', { from, to });
  return Math.round(haversineKm(from, to) * ROAD_FACTOR * 100) / 100;
}

async function getJson<T>(name: string, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(ROUTING_TIMEOUT_MS) });
  } catch (err) {
    throw new RoutingError(String(err));
  }
  if (!res.ok) throw new RoutingError(`${name} responded ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new RoutingError(`Invalid ${name} response: ${String(err)}`);
  }
}

async function osrmKm(env: RoutingEnv, from: LatLng, to: LatLng) {
  const data = await getJson<{ code?: string; routes?: { distance?: number }[] }>(
    'OSRM',
    `${env.OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
    // The public OSRM server drops requests without a User-Agent.
    { headers: { accept: 'application/json', 'user-agent': env.OSRM_USER_AGENT } },
  );
  const distance = data.code === 'Ok' ? data.routes?.[0]?.distance : undefined;
  if (typeof distance !== 'number') throw new RoutingError('No OSRM route distance');
  return km2(distance);
}

async function orsKm(env: RoutingEnv, from: LatLng, to: LatLng) {
  const data = await getJson<{ routes?: { summary?: { distance?: number } }[] }>('OpenRouteService', `${env.ORS_URL}/v2/directions/driving-car`, {
    method: 'POST',
    headers: { authorization: env.ORS_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
  });
  const distance = data.routes?.[0]?.summary?.distance;
  if (typeof distance !== 'number') throw new RoutingError('No OpenRouteService route distance');
  return km2(distance);
}
