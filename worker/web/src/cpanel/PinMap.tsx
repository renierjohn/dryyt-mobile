import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useRef } from 'react';

// Leaflet looks for its marker images next to its CSS; bundled, they need their URLs from Vite.
const pinIcon = L.icon({
	iconUrl: markerIcon,
	iconRetinaUrl: markerIcon2x,
	shadowUrl: markerShadow,
	iconSize: [25, 41],
	iconAnchor: [12, 41],
	shadowSize: [41, 41],
});

export type LatLng = { lat: number; lng: number };

/** OpenStreetMap with one pin. Clicking the map or dragging the pin calls onMove; `pin` moves it back (e.g. on Reset). */
export function PinMap({ pin, center, onMove }: { pin: LatLng | null; center: LatLng; onMove: (p: LatLng) => void }) {
	const box = useRef<HTMLDivElement>(null);
	const map = useRef<L.Map | null>(null);
	const marker = useRef<L.Marker | null>(null);
	const move = useRef(onMove);
	move.current = onMove;

	useEffect(() => {
		const m = L.map(box.current!, { center: pin ?? center, zoom: pin ? 17 : 13 });
		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		}).addTo(m);
		m.on('click', (e: L.LeafletMouseEvent) => move.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
		map.current = m;
		// The modal sizes itself after mount.
		const t = setTimeout(() => m.invalidateSize(), 50);
		return () => {
			clearTimeout(t);
			m.remove();
			map.current = null;
			marker.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const m = map.current;
		if (!m) return;
		if (!pin) {
			marker.current?.remove();
			marker.current = null;
			return;
		}
		if (!marker.current) {
			marker.current = L.marker(pin, { icon: pinIcon, draggable: true }).addTo(m);
			marker.current.on('dragend', () => {
				const p = marker.current!.getLatLng();
				move.current({ lat: p.lat, lng: p.lng });
			});
		} else {
			marker.current.setLatLng(pin);
		}
	}, [pin]);

	return <div ref={box} className="cp-map" />;
}
