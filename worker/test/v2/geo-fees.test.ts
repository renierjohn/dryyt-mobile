import { describe, expect, it } from 'vitest';

import { computeFees, discountedPrice, roundUpToPeso } from '../../src/lib/fees';
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
      service_fee: 800,
      total_delivery_fee: 8000,
    });
  });

  it('rounds every amount up to a whole peso', () => {
    // ₱63.45 → ₱64.00; 10% of ₱64.00 = ₱6.40 → ₱7.00.
    expect(computeFees(2.345, { base_fee: 4000, rate_per_km: 1000, commission_pct: 10 })).toEqual({
      delivery_fee: 6400,
      service_fee: 700,
      total_delivery_fee: 7100,
    });
  });

  it("doesn't add a peso for float noise", () => {
    // 3.3 × 1000 is 3299.9999999999995 in floating point.
    expect(computeFees(3.3, { base_fee: 0, rate_per_km: 1000, commission_pct: 0 }).delivery_fee).toBe(3300);
    expect(roundUpToPeso(3200.0000000000005)).toBe(3200);
    expect(roundUpToPeso(3201)).toBe(3300);
  });

  it('rounds a discounted menu price up to a whole peso', () => {
    // ₱125.00 less 15% = ₱106.25 → ₱107.00.
    expect(discountedPrice(12500, 15)).toBe(10700);
    expect(discountedPrice(12000, 20)).toBe(9600);
  });
});
