import { useEffect, useState } from 'react';
import { api, peso } from './api';
import { addMonths, today } from './dates';

type Fee = { id: number; amount: number; type: 'pickup' | 'dropoff'; payment_type: string; date_paid: string; next_due_date: string | null };
type Owner = { id: number; name: string; last_fee_amount: number | null; last_fee_paid: string | null; next_due_date: string | null };

const TYPE_LABEL = { pickup: 'Pickup + Store', dropoff: 'Drop off' };
const addMonth = (d: string) => addMonths(d, 1);

/** YYYY-MM-DD as "Oct 20, 2026". */
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—');

/** Owners tab "Subscription" cell: the last amount paid; opens the payment history. */
export function SubscriptionCell({ owner, onAuthError }: { owner: Owner; onAuthError: (e: unknown) => void }) {
	const [open, setOpen] = useState(false);
	const [last, setLast] = useState(owner);
	useEffect(() => setLast(owner), [owner]);
	const overdue = last.next_due_date !== null && last.next_due_date < today();

	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)}>
				{last.last_fee_amount === null ? (
					<span className="cp-muted">None yet</span>
				) : (
					<>
						<b>{peso(last.last_fee_amount)}</b>
						<small className="cp-sub">{day(last.last_fee_paid)}</small>
					</>
				)}
			</button>
			{overdue && <span className="cp-badge s-overdue">overdue</span>}
			{open && (
				<FeesModal
					owner={last}
					onClose={() => setOpen(false)}
					onAuthError={onAuthError}
					onLatest={(f) => setLast({ ...last, last_fee_amount: f.amount, last_fee_paid: f.date_paid, next_due_date: f.next_due_date })}
				/>
			)}
		</>
	);
}

function FeesModal({ owner, onClose, onAuthError, onLatest }: { owner: Owner; onClose: () => void; onAuthError: (e: unknown) => void; onLatest: (f: Fee) => void }) {
	const [fees, setFees] = useState<Fee[] | null>(null);
	const [error, setError] = useState('');
	const [adding, setAdding] = useState(false);

	useEffect(() => {
		api<{ fees: Fee[] }>(`/admin/owners/${owner.id}/fees`)
			.then((r) => setFees(r.fees))
			.catch((e) => {
				setError(e instanceof Error ? e.message : 'Request failed');
				onAuthError(e);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [owner.id]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const added = (f: Fee) => {
		// Newest date first, same as the API.
		const list = [f, ...(fees ?? [])].sort((a, b) => b.date_paid.localeCompare(a.date_paid) || b.id - a.id);
		setFees(list);
		onLatest(list[0]);
		setAdding(false);
	};
	const total = fees?.reduce((sum, f) => sum + f.amount, 0) ?? 0;

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal" role="dialog" aria-modal="true" aria-label={`Subscription · ${owner.name}`} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					<h3>
						Subscription · {owner.name}
						{owner.next_due_date && <small className="cp-sub">Next due {day(owner.next_due_date)}</small>}
					</h3>
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				{error && <p className="cp-error">{error}</p>}
				{!fees && !error && <p className="cp-muted">Loading…</p>}
				{fees && (
					<div className="cp-table-wrap">
						<table className="cp-table">
							<thead>
								<tr>
									<th>Date paid</th>
									<th>Type</th>
									<th>Payment</th>
									<th className="num">Amount</th>
									<th>Next due</th>
								</tr>
							</thead>
							<tbody>
								{fees.map((f) => (
									<tr key={f.id}>
										<td>{day(f.date_paid)}</td>
										<td>
											<span className={`cp-badge s-${f.type === 'pickup' ? 'food' : 'laundry'}`}>{TYPE_LABEL[f.type]}</span>
										</td>
										<td>{f.payment_type}</td>
										<td className="num">{peso(f.amount)}</td>
										<td>{day(f.next_due_date)}</td>
									</tr>
								))}
								{fees.length === 0 && (
									<tr>
										<td colSpan={5} className="cp-empty">
											No payments yet
										</td>
									</tr>
								)}
							</tbody>
							{fees.length > 0 && (
								<tfoot>
									<tr>
										<td colSpan={3}>
											<b>Total</b>
										</td>
										<td className="num">
											<b>{peso(total)}</b>
										</td>
										<td />
									</tr>
								</tfoot>
							)}
						</table>
					</div>
				)}
				{adding ? (
					<AddFee ownerId={owner.id} onAdded={added} onCancel={() => setAdding(false)} onAuthError={onAuthError} />
				) : (
					<div className="cp-rate-actions">
						<button className="cp-btn cp-btn-sm" onClick={() => setAdding(true)}>
							+ Record payment
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function AddFee({ ownerId, onAdded, onCancel, onAuthError }: { ownerId: number; onAdded: (f: Fee) => void; onCancel: () => void; onAuthError: (e: unknown) => void }) {
	const [draft, setDraft] = useState(() => ({ amount: '', type: 'pickup', payment_type: 'cash', date_paid: today(), next_due_date: addMonth(today()) }));
	// Next due follows date paid (one month on) until the admin picks it themselves.
	const [dueTouched, setDueTouched] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		const value = e.target.value;
		if (k === 'next_due_date') setDueTouched(true);
		setDraft({ ...draft, [k]: value, ...(k === 'date_paid' && !dueTouched && value ? { next_due_date: addMonth(value) } : {}) });
	};
	const amount = Math.round(Number(draft.amount) * 100);
	const ok = amount > 0 && draft.payment_type.trim() !== '' && draft.date_paid !== '' && (!draft.next_due_date || draft.next_due_date > draft.date_paid);

	const save = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!ok) return;
		setSaving(true);
		setError('');
		try {
			const res = await api<{ fee: Fee }>(`/admin/owners/${ownerId}/fees`, {
				body: { ...draft, amount, payment_type: draft.payment_type.trim(), next_due_date: draft.next_due_date || null },
			});
			onAdded(res.fee);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed');
			onAuthError(err);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form className="cp-fee-form" onSubmit={save}>
			<label className="cp-field">
				Amount (₱)
				<input type="number" min={0} step="0.01" value={draft.amount} onChange={set('amount')} autoFocus />
			</label>
			<label className="cp-field">
				Type
				<select value={draft.type} onChange={set('type')}>
					<option value="pickup">{TYPE_LABEL.pickup}</option>
					<option value="dropoff">{TYPE_LABEL.dropoff}</option>
				</select>
			</label>
			<label className="cp-field">
				Payment type
				<input list="cp-payment-types" value={draft.payment_type} onChange={set('payment_type')} maxLength={40} />
				<datalist id="cp-payment-types">
					<option value="cash" />
					<option value="gcash" />
					<option value="maya" />
					<option value="bank" />
				</datalist>
			</label>
			<label className="cp-field">
				Date paid
				<input type="date" value={draft.date_paid} onChange={set('date_paid')} />
			</label>
			<label className="cp-field">
				Next due date
				<input type="date" value={draft.next_due_date} min={draft.date_paid || undefined} onChange={set('next_due_date')} />
			</label>
			<div className="cp-rate-actions">
				{error && <span className="cp-error-inline">{error}</span>}
				<button type="button" className="cp-btn-ghost" onClick={onCancel}>
					Cancel
				</button>
				<button className="cp-btn cp-btn-sm" disabled={!ok || saving}>
					{saving ? 'Saving…' : 'Save payment'}
				</button>
			</div>
		</form>
	);
}
