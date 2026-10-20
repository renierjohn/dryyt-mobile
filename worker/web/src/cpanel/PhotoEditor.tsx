import { useEffect, useRef, useState } from 'react';
import { api, apiBinary } from './api';

type Box = { x: number; y: number; w: number; h: number };

/**
 * Blurs a box of the canvas: the area is shrunk to a few pixels and stretched back with smoothing. Works in every
 * browser (unlike ctx.filter) and, being heavy, leaves nothing readable behind.
 */
function blurBox(ctx: CanvasRenderingContext2D, b: Box) {
	const w = Math.max(1, Math.round(b.w));
	const h = Math.max(1, Math.round(b.h));
	const small = document.createElement('canvas');
	small.width = Math.max(1, Math.round(w / 24));
	small.height = Math.max(1, Math.round(h / 24));
	const s = small.getContext('2d')!;
	s.imageSmoothingEnabled = true;
	s.drawImage(ctx.canvas, b.x, b.y, w, h, 0, 0, small.width, small.height);
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(small, 0, 0, small.width, small.height, b.x, b.y, w, h);
}

/** Box from two corners, in image pixels, kept inside the image. */
function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number): Box {
	const x = Math.max(0, Math.min(a.x, b.x));
	const y = Math.max(0, Math.min(a.y, b.y));
	return { x, y, w: Math.min(width, Math.max(a.x, b.x)) - x, h: Math.min(height, Math.max(a.y, b.y)) - y };
}

/**
 * Drivers tab: a driver's license photo, with drag-to-blur boxes (Undo, Save replaces the photo) and the verified switch.
 * The original is deleted on save, so blurred details can't be recovered.
 */
export function LicenseModal({
	driver,
	onClose,
	onVerified,
	onAuthError,
}: {
	driver: { id: number; name: string; verified: number };
	onClose: () => void;
	onVerified: (verified: boolean) => void;
	onAuthError: (e: unknown) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [image, setImage] = useState<HTMLImageElement | null>(null);
	const [boxes, setBoxes] = useState<Box[]>([]);
	const [drag, setDrag] = useState<{ start: { x: number; y: number }; box: Box } | null>(null);
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [verified, setVerified] = useState(driver.verified === 1);
	const [switching, setSwitching] = useState(false);

	useEffect(() => {
		let url = '';
		apiBinary(`/admin/drivers/${driver.id}/photo/id`)
			.then((blob) => {
				url = URL.createObjectURL(blob);
				const img = new Image();
				img.onload = () => setImage(img);
				img.onerror = () => setError('Could not open the photo');
				img.src = url;
			})
			.catch((e) => {
				setError(e instanceof Error ? e.message : 'Request failed');
				onAuthError(e);
			});
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [driver.id]);

	// Redraw: the photo, the blurred boxes, and the box being dragged (outlined, not yet blurred).
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !image) return;
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(image, 0, 0);
		for (const b of boxes) blurBox(ctx, b);
		if (drag) {
			ctx.save();
			ctx.strokeStyle = '#3b82f6';
			ctx.lineWidth = Math.max(2, canvas.width / 300);
			ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
			ctx.strokeRect(drag.box.x, drag.box.y, drag.box.w, drag.box.h);
			ctx.restore();
		}
	}, [image, boxes, drag]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	/** Pointer position in image pixels (the canvas is scaled down to fit). */
	const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
	};
	const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!image || saving) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		const p = point(e);
		setDrag({ start: p, box: { ...p, w: 0, h: 0 } });
		setSaved(false);
	};
	const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (drag && image) setDrag({ ...drag, box: boxBetween(drag.start, point(e), image.naturalWidth, image.naturalHeight) });
	};
	const onUp = () => {
		// Ignore taps and slivers.
		if (drag && drag.box.w > 8 && drag.box.h > 8) setBoxes([...boxes, drag.box]);
		setDrag(null);
	};

	const save = () => {
		const canvas = canvasRef.current;
		if (!canvas || boxes.length === 0) return;
		setSaving(true);
		setError('');
		canvas.toBlob(
			async (blob) => {
				try {
					if (!blob) throw new Error('Could not encode the photo');
					await apiBinary(`/admin/drivers/${driver.id}/photo/id`, blob);
					// The saved photo now has the blur baked in.
					const img = new Image();
					img.onload = () => {
						setImage(img);
						setBoxes([]);
						setSaved(true);
					};
					img.src = canvas.toDataURL('image/jpeg', 0.9);
				} catch (e) {
					setError(e instanceof Error ? e.message : 'Save failed');
					onAuthError(e);
				} finally {
					setSaving(false);
				}
			},
			'image/jpeg',
			0.9,
		);
	};

	const toggleVerified = async () => {
		const next = !verified;
		if (!confirm(next ? `Verify ${driver.name}? Their photos and plate get locked.` : `Unverify ${driver.name}? They can change their details again.`)) return;
		setSwitching(true);
		try {
			const res = await api<{ verified: boolean }>(`/admin/drivers/${driver.id}/verified`, { body: { verified: next } });
			setVerified(res.verified);
			onVerified(res.verified);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Request failed');
			onAuthError(e);
		} finally {
			setSwitching(false);
		}
	};

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal cp-modal-wide" role="dialog" aria-modal="true" aria-label={`License · ${driver.name}`} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					<h3>
						Driver's license · {driver.name}
						<small className="cp-sub">Drag over the photo to blur a part, then Save.</small>
					</h3>
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				<label className="cp-switch">
					<input type="checkbox" role="switch" checked={verified} disabled={switching} onChange={toggleVerified} />
					<span>{verified ? 'Verified' : 'Not verified'}</span>
				</label>
				{error && <p className="cp-error">{error}</p>}
				{!image && !error && <p className="cp-muted">Loading…</p>}
				<canvas
					ref={canvasRef}
					className="cp-photo-canvas"
					style={image ? undefined : { display: 'none' }}
					onPointerDown={onDown}
					onPointerMove={onMove}
					onPointerUp={onUp}
					onPointerCancel={() => setDrag(null)}
				/>
				<div className="cp-rate-actions">
					{saved && <span className="cp-ok">Saved</span>}
					{boxes.length > 0 && <span className="cp-muted">{boxes.length} part{boxes.length === 1 ? '' : 's'} to blur</span>}
					<button className="cp-btn-ghost" disabled={boxes.length === 0 || saving} onClick={() => setBoxes(boxes.slice(0, -1))}>
						Undo
					</button>
					<button className="cp-btn-ghost" disabled={boxes.length === 0 || saving} onClick={() => setBoxes([])}>
						Clear
					</button>
					<button className="cp-btn cp-btn-sm" disabled={boxes.length === 0 || saving} onClick={save}>
						{saving ? 'Saving…' : 'Save photo'}
					</button>
				</div>
			</div>
		</div>
	);
}
