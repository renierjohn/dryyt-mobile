import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api';
import type { LatLng } from './PinMap';
import { useApi } from './useList';

type Gateway = { label: string; image_url: string };
type Store = {
	id: number;
	name: string;
	type: string;
	address: string;
	group_id: string;
	lat: number | null;
	lng: number | null;
	store_logo: string | null;
	store_payment_gateway: Gateway[];
	owner_name: string | null;
	owner_email: string | null;
	owner_phone: string | null;
};

// Leaflet is ~160 kB: load it only when a store's details open.
const PinMap = lazy(() => import('./PinMap').then((m) => ({ default: m.PinMap })));

/** Where the map opens for a store with no pin yet: Dauin, Negros Oriental (town proper). */
const DAUIN: LatLng = { lat: 9.1906, lng: 123.2669 };

/** Stores tab "#" cell: opens the store's name, logo, payment QR codes and map location. */
export function StoreDetailsCell({ id, onAuthError }: { id: number; onAuthError: (e: unknown) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)} title="Store details">
				<b>{id}</b>
			</button>
			{open && <StoreDetailsModal id={id} onClose={() => setOpen(false)} onAuthError={onAuthError} />}
		</>
	);
}

function StoreDetailsModal({ id, onClose, onAuthError }: { id: number; onClose: () => void; onAuthError: (e: unknown) => void }) {
	const { data, error } = useApi<{ store: Store }>(`/admin/stores/${id}`, {}, onAuthError);
	const [zoom, setZoom] = useState<Gateway | null>(null);
	const s = data?.store;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (zoom ? setZoom(null) : onClose());
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose, zoom]);

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal cp-modal-wide" role="dialog" aria-modal="true" aria-label={s ? `Store · ${s.name}` : 'Store'} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					{s ? (
						<div className="cp-store-head">
							{s.store_logo ? <img src={s.store_logo} alt="" className="cp-store-logo-lg" /> : <span className="cp-logo-blank cp-store-logo-lg" />}
							<h3>
								{s.name} <span className={`cp-badge s-${s.type}`}>{s.type}</span>
								<small className="cp-sub">
									#{s.id} · {s.address} · area {s.group_id}
								</small>
								{s.owner_name && (
									<small className="cp-sub">
										Owner: {s.owner_name} · {s.owner_email} · {s.owner_phone}
									</small>
								)}
							</h3>
						</div>
					) : (
						<h3>Store #{id}</h3>
					)}
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				{error && <p className="cp-error">{error}</p>}
				{!s && !error && <p className="cp-muted">Loading…</p>}
				{s && (
					<>
						<section>
							<h4 className="cp-section-title">Payment gateway</h4>
							{s.store_payment_gateway.length === 0 ? (
								<p className="cp-muted">No payment QR codes yet.</p>
							) : (
								<div className="cp-qr-grid">
									{s.store_payment_gateway.map((g) => (
										<button key={g.image_url} className="cp-qr" onClick={() => setZoom(g)} title="View larger">
											<img src={g.image_url} alt={`${g.label} QR code`} loading="lazy" />
											<span>{g.label}</span>
										</button>
									))}
								</div>
							)}
						</section>
						<LocationSection store={s} onAuthError={onAuthError} />
					</>
				)}
			</div>
			{zoom && (
				<div className="cp-modal-backdrop" onClick={(e) => (e.stopPropagation(), setZoom(null))}>
					<figure className="cp-qr-zoom">
						<img src={zoom.image_url} alt={`${zoom.label} QR code`} />
						<figcaption>{zoom.label}</figcaption>
					</figure>
				</div>
			)}
		</div>
	);
}

/** The store's pin: click the map or drag the pin, then Save. */
function LocationSection({ store, onAuthError }: { store: Store; onAuthError: (e: unknown) => void }) {
	const savedPin = store.lat !== null && store.lng !== null ? { lat: store.lat, lng: store.lng } : null;
	const [saved, setSaved] = useState<LatLng | null>(savedPin);
	const [pin, setPin] = useState<LatLng | null>(savedPin);
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	const moved = pin !== null && (pin.lat !== saved?.lat || pin.lng !== saved?.lng);

	const save = async () => {
		if (!pin || !confirm(`Move ${store.name}'s pin to ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}? New bookings price their distance from here.`)) return;
		setSaving(true);
		try {
			// 6 decimals is ~10 cm; no need to store the map's full float.
			const round = (n: number) => Math.round(n * 1e6) / 1e6;
			const res = await api<LatLng>(`/admin/stores/${store.id}/location`, { body: { lat: round(pin.lat), lng: round(pin.lng) } });
			setSaved(res);
			setPin(res);
			setMsg({ ok: true, text: 'Saved' });
		} catch (e) {
			setMsg({ ok: false, text: e instanceof Error ? e.message : 'Save failed' });
			onAuthError(e);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section>
			<h4 className="cp-section-title">
				Location{' '}
				<span className="cp-muted">
					{pin ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : 'No map location yet'}
					{saved && (
						<>
							{' · '}
							<a href={`https://www.openstreetmap.org/?mlat=${saved.lat}&mlon=${saved.lng}#map=17/${saved.lat}/${saved.lng}`} target="_blank" rel="noreferrer">
								Open map
							</a>
						</>
					)}
				</span>
			</h4>
			<Suspense fallback={<div className="cp-map cp-map-loading">Loading map…</div>}>
				<PinMap
					pin={pin}
					center={saved ?? DAUIN}
					onMove={(p) => {
						setPin(p);
						setMsg(null);
					}}
				/>
			</Suspense>
			<div className="cp-rate-actions">
				<span className="cp-muted cp-grow">Click the map or drag the pin to move it.</span>
				{msg && <span className={msg.ok ? 'cp-ok' : 'cp-error-inline'}>{msg.text}</span>}
				<button className="cp-btn-ghost" disabled={!moved || saving} onClick={() => setPin(saved)}>
					Reset
				</button>
				<button className="cp-btn cp-btn-sm" disabled={!moved || saving} onClick={save}>
					{saving ? 'Saving…' : 'Save location'}
				</button>
			</div>
		</section>
	);
}
