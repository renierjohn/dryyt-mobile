import { useEffect, useState, type ReactNode } from 'react';
import { apiBinary, peso } from './api';
import { useApi } from './useList';

type Item = { id: number; name: string; price: number; qty: number; image_url: string | null };
type Order = {
	id: number;
	store_name: string;
	store_type: 'food' | 'laundry';
	status: string;
	notes: string;
	items_total: number;
	total_delivery_fee: number;
	payment_ref: string;
	has_payment_photo: boolean;
	items: Item[];
};

/** Pickup orders' Items cell: opens the order's lines (food) or note (laundry) and its proof of payment. */
export function OrderItemsCell({ id, children, onAuthError }: { id: number; children: ReactNode; onAuthError: (e: unknown) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)} title="Items and proof of payment">
				<b>{children}</b>
			</button>
			{open && <OrderItemsModal id={id} onClose={() => setOpen(false)} onAuthError={onAuthError} />}
		</>
	);
}

function OrderItemsModal({ id, onClose, onAuthError }: { id: number; onClose: () => void; onAuthError: (e: unknown) => void }) {
	const { data, error } = useApi<{ order: Order }>(`/admin/orders/${id}`, {}, onAuthError);
	const o = data?.order;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal" role="dialog" aria-modal="true" aria-label={`Order #${id}`} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					<h3>
						Order #{id}
						{o && (
							<small className="cp-sub">
								{o.store_name} · {o.store_type === 'laundry' ? 'Laundry pickup' : 'Food'}
							</small>
						)}
					</h3>
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				{error && <p className="cp-error">{error}</p>}
				{!o && !error && <p className="cp-muted">Loading…</p>}
				{o && o.store_type === 'laundry' && (
					<div className="cp-order-note">
						<b>Note</b>
						<p>{o.notes || <span className="cp-muted">No note</span>}</p>
						<span>
							Laundry fee <b>{o.items_total > 0 || o.status !== 'awaiting_fee' ? peso(o.items_total) : 'not set yet'}</b>
						</span>
					</div>
				)}
				{o && o.store_type === 'food' && (
					<div className="cp-table-wrap">
						<table className="cp-table">
							<thead>
								<tr>
									<th>Item</th>
									<th className="num">Qty</th>
									<th className="num">Amount</th>
									<th className="num">Total</th>
								</tr>
							</thead>
							<tbody>
								{o.items.map((i) => (
									<tr key={i.id}>
										<td>
											<span className="cp-store">
												{i.image_url ? <img src={i.image_url} alt="" /> : <span className="cp-logo-blank" />}
												{i.name}
											</span>
										</td>
										<td className="num">{i.qty}</td>
										<td className="num">{peso(i.price)}</td>
										<td className="num">{peso(i.price * i.qty)}</td>
									</tr>
								))}
								{o.items.length === 0 && (
									<tr>
										<td colSpan={4} className="cp-empty">
											No items
										</td>
									</tr>
								)}
							</tbody>
							<tfoot>
								<tr>
									<td colSpan={3}>
										<b>Items total</b>
									</td>
									<td className="num">
										<b>{peso(o.items_total)}</b>
									</td>
								</tr>
								{o.notes && (
									<tr>
										<td colSpan={4} className="cp-muted">
											Note: {o.notes}
										</td>
									</tr>
								)}
							</tfoot>
						</table>
					</div>
				)}
				{o && (
					<div className="cp-order-proof">
						<b>Proof of payment</b>
						{o.payment_ref && <span>Ref. {o.payment_ref}</span>}
						{o.has_payment_photo ? (
							<PaymentPhoto id={o.id} onAuthError={onAuthError} />
						) : (
							!o.payment_ref && <span className="cp-muted">Not sent yet</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/** The customer's payment photo, loaded with the admin token. */
function PaymentPhoto({ id, onAuthError }: { id: number; onAuthError: (e: unknown) => void }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let objectUrl: string | null = null;
		apiBinary(`/admin/orders/${id}/payment-photo`)
			.then((blob) => {
				objectUrl = URL.createObjectURL(blob);
				setUrl(objectUrl);
			})
			.catch(onAuthError);
		return () => {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id]);
	return url ? <img className="cp-proof-large" src={url} alt="Proof of payment" /> : <span className="cp-muted">Loading photo…</span>;
}
