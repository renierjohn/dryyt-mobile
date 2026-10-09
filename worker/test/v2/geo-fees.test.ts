import { describe, expect, it } from 'vitest';

import { computeFees } from '../../src/lib/fees';
import { distanceColour, geohash, haversineKm, nearbyCells } from '../../src/lib/geo';

describe('geo', () => {
  it('measures straight-line distance', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });

  it('encodes geohashes', () => {
    expect(geohash({ lat: 57.64911, lng: 10.40744 }, 11)).toBe('u4pruydqqvj');
    expect(geohash({ lat: 57.64911, lng: 10.40744 })).toBe('u4pru');
  });

  it('returns an 11x11 block of cells covering 20 km', () => {
    const p = { lat: 14.56, lng: 121.03 };
    const cells = nearbyCells(p);
    expect(cells.size).toBe(121);
    expect(cells.has(geohash(p))).toBe(true);
    expect(cells.has(geohash({ lat: p.lat + 0.18, lng: p.lng }))).toBe(true); // ~20 km north
  });

  it('colours by distance', () => {
    expect(distanceColour(9.9)).toBe('green');
    expect(distanceColour(10)).toBe('green');
    expect(distanceColour(15)).toBe('amber');
    expect(distanceColour(20.1)).toBeNull();
  });
});

describe('fees', () => {
  it('adds base fee, distance fee and commission', () => {
    expect(computeFees(3.2, { base_fee: 4000, rate_per_km: 1000, commission_pct: 10 })).toEqual({
      delivery_fee: 7200,
      service_fee: 720,
      total_delivery_fee: 7920,
    });
  });

  it('rounds fractional distance and commission', () => {
    const fees = computeFees(2.345, { base_fee: 4000, rate_per_km: 1000, commission_pct: 12.5 });
    expect(fees).toEqual({ delivery_fee: 6345, service_fee: 793, total_delivery_fee: 7138 });
    expect(Number.isInteger(fees.delivery_fee) && Number.isInteger(fees.service_fee)).toBe(true);
  });
});
