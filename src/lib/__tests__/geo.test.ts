import { distanceMeters } from '../geo';

describe('distanceMeters', () => {
  it('is 0 for the same point', () => {
    expect(distanceMeters({ lat: 9.19, lng: 123.26 }, { lat: 9.19, lng: 123.26 })).toBe(0);
  });

  it('measures about 111 m per 0.001° of latitude', () => {
    expect(distanceMeters({ lat: 9.19, lng: 123.26 }, { lat: 9.191, lng: 123.26 })).toBeCloseTo(111.2, 0);
  });
});
