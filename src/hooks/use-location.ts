import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

import type { LatLng } from '@/lib/types';

const PERMISSION_ERROR = 'Allow location access to use drop off.';
/** Stop refining the pickup pin once a fix is this good (meters). */
const GOOD_ACCURACY_M = 10;
/** Give up refining after this long and keep the best fix so far. */
const REFINE_MS = 20_000;

/**
 * The customer's location, refined: the first fix is often a Wi-Fi/cell guess 20-50 m off, so keep
 * watching GPS and keep the most accurate fix until it's within GOOD_ACCURACY_M or REFINE_MS passes.
 * `accuracy` is the fix's radius in meters (68% confidence), or null if the phone didn't say.
 */
export function useCurrentLocation() {
  const [loc, setLoc] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    let best = Infinity;
    const stop = () => {
      sub?.remove();
      sub = null;
    };
    const timer = setTimeout(stop, REFINE_MS);
    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) throw new Error(PERMISSION_ERROR);
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (pos) => {
        const acc = pos.coords.accuracy ?? Infinity;
        if (cancelled || (acc >= best && best !== Infinity)) return;
        best = acc;
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAccuracy(Number.isFinite(acc) ? acc : null);
        if (acc <= GOOD_ACCURACY_M) stop();
      });
      if (cancelled) stop();
    })().catch((err: Error) => {
      if (!cancelled) setError(err.message);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
    };
  }, []);

  return { loc, accuracy, error };
}

/** How often a driver's location goes out: each fix is a billed Durable Object message, and the worker drops drivers after 30 s. */
const WATCH_EVERY_MS = 10_000;

/** Calls `onLocation` about every 10 s while `enabled` (foreground only: the app must stay open). `accuracy` is in meters. */
export function useWatchLocation(enabled: boolean, onLocation: (at: LatLng, accuracy: number | null) => void) {
  const handler = useRef(onLocation);

  useEffect(() => {
    handler.current = onLocation;
  });

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    let last = 0;
    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted || cancelled) return;
      // iOS ignores timeInterval and reports about every second, so skip fixes that come too soon.
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: WATCH_EVERY_MS, distanceInterval: 0 },
        (pos) => {
          if (pos.timestamp - last < WATCH_EVERY_MS - 500) return;
          last = pos.timestamp;
          handler.current({ lat: pos.coords.latitude, lng: pos.coords.longitude }, pos.coords.accuracy ?? null);
        },
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);
}
