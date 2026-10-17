import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { Icon } from '@/components/icon';
import { Brand, Spacing } from '@/constants/theme';
import type { LatLng } from '@/lib/types';

export type PinIcon = 'person' | 'motorcycle' | 'store';
export type MapPin = { key: string; at: LatLng; title?: string; color: string; icon: PinIcon };

// Material Symbols paths (24x24 viewBox), drawn white on the pin colour.
const ICON_PATHS: Record<PinIcon, string> = {
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  motorcycle:
    'M19.44 9.03L15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h1.65l2.77-2.77c-.21.54-.32 1.14-.32 1.77 0 2.8 2.2 5 5 5s5-2.2 5-5c0-2.65-1.97-4.77-4.56-4.97zM7.82 15C7.4 16.15 6.28 17 5 17c-1.63 0-3-1.37-3-3s1.37-3 3-3c1.28 0 2.4.85 2.82 2H5v2h2.82zM19 17c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z',
  store: 'M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z',
};

export const PinColor = {
  customer: Brand.success,
  shop: Brand.primary,
  driver: Brand.success,
  near: Brand.success,
  far: Brand.warning,
};

const ZOOM = 13; // ~5 km across
const GLIDE_MS = 1500; // pin move animation
const FIT_MAX_ZOOM = 16; // don't zoom in to street level when the pins sit close together

// OSM's tile policy wants an honest Referer and an app-identifying User-Agent.
const BASE_URL = 'https://dryyt.com/';
const USER_AGENT_SUFFIX = `Dryyt/${Constants.expoConfig?.version ?? '1.0.0'}`;

// OpenStreetMap Standard raster tiles: free, no key, CDN-backed, and plain images so old WebViews without WebGL work.
// The usage policy allows light app use; move to a paid or self-hosted tile server if traffic grows.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Leaflet page: pins and the road path are pushed in with setPins() so updates don't reload the map.
const page = (center: LatLng) => `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html, body, #map { margin: 0; height: 100%; }
.pin { display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); box-sizing: border-box; }</style>
</head><body><div id="map"></div><script>
const map = L.map('map', { zoomControl: false }).setView([${center.lat}, ${center.lng}], ${ZOOM});
L.tileLayer('${TILE_URL}', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const ICONS = ${JSON.stringify(ICON_PATHS)};
const pinIcon = (p) => L.divIcon({
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
  html: '<div class="pin" style="width:32px;height:32px;background:' + p.color + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="' + ICONS[p.icon] + '"/></svg></div>',
});
const markers = {};
let fitted = false;
const fittedKeys = new Set();
let line = null;
let lastPath = '';
// Glides a marker to its new spot; driver fixes come every few seconds.
const glide = (m, to) => {
  const from = m.getLatLng();
  const start = performance.now();
  cancelAnimationFrame(m._glide);
  const step = (now) => {
    const t = Math.min(1, (now - start) / ${GLIDE_MS});
    const e = t * (2 - t);
    m.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]);
    if (t < 1) m._glide = requestAnimationFrame(step);
  };
  m._glide = requestAnimationFrame(step);
};
window.setPins = (pins, path) => {
  const pathKey = JSON.stringify(path);
  if (pathKey !== lastPath) {
    lastPath = pathKey;
    if (line) line.remove();
    line = null;
    if (path.length > 1) {
      line = L.polyline(path, { color: '${Brand.primary}', weight: 5, opacity: 0.8 }).addTo(map);
      fitted = false;
    }
  }
  // Fit every pin (and the road) on first show, when a new pin appears (e.g. the driver's first fix) and when the road changes;
  // live pin moves leave the view alone.
  if (pins.some((p) => !fittedKeys.has(p.key))) fitted = false;
  if (!fitted && pins.length > 0) {
    fitted = true;
    for (const p of pins) fittedKeys.add(p.key);
    const bounds = L.latLngBounds(pins.map((p) => [p.at.lat, p.at.lng]));
    if (line) bounds.extend(line.getBounds());
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: ${FIT_MAX_ZOOM} });
  }
  const seen = new Set();
  for (const p of pins) {
    seen.add(p.key);
    const at = [p.at.lat, p.at.lng];
    let m = markers[p.key];
    const look = p.color + p.icon;
    if (!m) {
      m = markers[p.key] = L.marker(at, { icon: pinIcon(p) }).addTo(map);
    } else {
      glide(m, at);
    }
    if (m._look !== look) {
      m._look = look;
      m.setIcon(pinIcon(p));
    }
    if (p.title) m.bindPopup(p.title);
  }
  for (const key of Object.keys(markers)) {
    if (!seen.has(key)) {
      markers[key].remove();
      delete markers[key];
    }
  }
};
map.on('click', (e) => window.ReactNativeWebView.postMessage(JSON.stringify({ lat: e.latlng.lat, lng: e.latlng.lng })));
</script></body></html>`;

type Props = {
  center: LatLng;
  pins: MapPin[];
  /** Road path as [lat, lng] points; the map zooms to fit it with the pins. */
  path?: [number, number][];
  onPress?: (at: LatLng) => void;
  height?: number;
};

/** Map card with a full screen button; full screen opens a second map over everything. */
export function DropoffMap({ height = 280, ...props }: Props) {
  const [full, setFull] = useState(false);
  // Read outside the Modal: safe-area insets are often zero inside one.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.map, { height }]}>
      <LeafletMap {...props} />
      <MapButton
        style={styles.corner}
        label="Full screen"
        icon={{
          ios: 'arrow.up.left.and.arrow.down.right',
          android: 'fullscreen',
          web: 'fullscreen',
        }}
        onPress={() => setFull(true)}
      />
      <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)}>
        <View style={styles.full}>
          <LeafletMap {...props} />
          <MapButton
            style={{ position: 'absolute', top: insets.top + Spacing.three, right: insets.right + Spacing.three }}
            label="Close full screen"
            icon={{ ios: 'xmark', android: 'close', web: 'close' }}
            onPress={() => setFull(false)}
          />
        </View>
      </Modal>
    </View>
  );
}

function MapButton({
  icon,
  label,
  onPress,
  style,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
  style: object;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.button, style]} hitSlop={8}>
      <Icon name={icon} size={20} color="#1C2024" />
    </Pressable>
  );
}

function LeafletMap({ center, pins, path = [], onPress }: Omit<Props, 'height'>) {
  const ref = useRef<WebView>(null);
  // Like initialRegion: later center changes don't move the map.
  const [html] = useState(() => page(center));
  const [ready, setReady] = useState(false);
  const json = `${JSON.stringify(pins)}, ${JSON.stringify(path)}`;

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.setPins(${json}); true;`);
  }, [ready, json]);

  return (
    <WebView
      ref={ref}
      source={{ html, baseUrl: BASE_URL }}
      originWhitelist={['*']}
      applicationNameForUserAgent={USER_AGENT_SUFFIX}
      scrollEnabled={false}
      onLoadEnd={() => setReady(true)}
      onMessage={onPress && ((e) => onPress(JSON.parse(e.nativeEvent.data) as LatLng))}
    />
  );
}

const styles = StyleSheet.create({
  map: { width: '100%', borderRadius: 16, overflow: 'hidden' },
  full: { flex: 1, backgroundColor: '#fff' },
  corner: { position: 'absolute', top: Spacing.two, right: Spacing.two },
  button: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.2)',
  },
});
