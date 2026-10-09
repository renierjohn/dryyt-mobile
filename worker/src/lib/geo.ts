import type { LatLng } from '../types';

export const NEAR_KM = 10;
export const MAX_KM = 20;

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash({ lat, lng }: LatLng, precision = 5): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bits = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    bits += 1;
    if (bits === 5) {
      hash += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}

// Precision-5 cell size: 12 latitude bits, 13 longitude bits (~4.9 km × ~4.7 km in Manila).
const CELL_LAT = 180 / 2 ** 12;
const CELL_LNG = 360 / 2 ** 13;

/** Precision-5 cells within `rings` cells of `p` (5 rings ≥ 23 km, so every driver within MAX_KM is included). */
export function nearbyCells(p: LatLng, rings = 5): Set<string> {
  const cells = new Set<string>();
  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      const lat = Math.max(-90, Math.min(90, p.lat + dy * CELL_LAT));
      const lng = ((p.lng + dx * CELL_LNG + 540) % 360) - 180;
      cells.add(geohash({ lat, lng }));
    }
  }
  return cells;
}

export function distanceColour(km: number): 'green' | 'amber' | null {
  if (km <= NEAR_KM) return 'green';
  if (km <= MAX_KM) return 'amber';
  return null;
}
