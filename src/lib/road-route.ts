import type { LatLng } from '@/lib/types';

export type RoadRoute = { road_km: number; path: [number, number][] };

// OSRM demo server on OpenStreetMap data (no key; light use only). Swap for a self-hosted OSRM in production.
const OSRM_URL = 'https://router.project-osrm.org';

/** Driving route between two points: distance in km (2 decimals) and the road path as [lat, lng] points. */
export async function roadRoute(from: LatLng, to: LatLng): Promise<RoadRoute> {
  const res = await fetch(
    `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
  );
  const data = (await res.json().catch(() => null)) as {
    code?: string;
    routes?: { distance: number; geometry: { coordinates: [number, number][] } }[];
  } | null;
  const route = data?.code === 'Ok' ? data.routes?.[0] : undefined;
  if (!res.ok || !route) throw new Error("Can't find a road route to the shop");
  return {
    road_km: Math.round(route.distance / 10) / 100,
    path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  };
}
