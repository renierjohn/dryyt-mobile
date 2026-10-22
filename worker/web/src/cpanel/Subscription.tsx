import { useEffect, useState } from 'react';
import { api, apiBinary, peso } from './api';
import { addMonths, today } from './dates';

/** `type` null: a proof the owner sent from the app (reference number and/or photo), not yet filled in. */
type Fee = {
	id: number;
	amount: number;
	type: keyof typeof TYPE_LABEL | null;
	payment_type: string;
	date_paid: string;
	next_due_date: string | null;
	ref_number: string;
	has_photo: boolean;
};
type Owner = {
	id: number;
	name: string;
	last_fee_amount: number | null;
	last_fee_paid: string | null;
	next_due_date: string | null;
	/** Proofs the owner sent from the app, not yet filled in. */
	fees_to_review: number;
};

/** app_fee.type: what the payment covers. */
const TYPE_LABEL = { both: 'Service fee & Subscription', service_fee: 'Service fee', subscription: 'Subscription' };
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
			{last.fees_to_review > 0 && <span className="cp-badge s-pending">{last.fees_to_review} to review</span>}
			{open && (
				<FeesModal
					owner={last}
					onClose={() => setOpen(false)}
					onAuthError={onAuthError}
					onLatest={(f, toReview) =>
						setLast({ ...last, last_fee_amount: f.amount, last_fee_paid: f.date_paid, next_due_date: f.next_due_date, fees_to_review: toReview })
					}
				/>
			)}
		</>
	);
}

function FeesModal({
	owner,
	onClose,
	onAuthError,
	onLatest,
}: {
	owner: Owner;
	onClose: () => void;
	onAuthError: (e: unknown) => void;
	onLatest: (f: Fee, toReview: number) => void;
}) {
	const [fees, setFees] = useState<Fee[] | null>(null);
	const [error, setError] = useState('');
	const [adding, setAdding] = useState(false);
	const [viewing, setViewing] = useState<Fee | null>(null);

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
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (viewing ? setViewing(null) : onClose());
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose, viewing]);

	const [reviewing, setReviewing] = useState<Fee | null>(null);
	// Saved: a new payment, or a proof filled in. Newest date first, same as the API.
	const saved = (f: Fee) => {
		const list = [f, ...(fees ?? []).filter((x) => x.id !== f.id)].sort((a, b) => b.date_paid.localeCompare(a.date_paid) || b.id - a.id);
		setFees(list);
		const latest = list.find((x) => x.type !== null);
		if (latest) onLatest(latest, list.filter((x) => x.type === null).length);
		setAdding(false);
		setReviewing(null);
	};
	const proofs = fees?.filter((f) => f.type === null) ?? [];
	const paid = fees?.filter((f) => f.type !== null) ?? [];
	const total = paid.reduce((sum, f) => sum + f.amount, 0);

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
				{proofs.length > 0 && (
					<div className="cp-proofs">
						<b>Proofs sent from the app</b>
						<div className="cp-proof-grid">
							{proofs.map((f) => (
								<button
									key={f.id}
									className={`cp-proof${reviewing?.id === f.id ? ' is-active' : ''}`}
									onClick={() => setReviewing(f)}
									title={f.ref_number ? `Ref. ${f.ref_number}` : 'Fill in this payment'}>
									{f.has_photo ? (
										<ProofPhoto id={f.id} onAuthError={onAuthError} />
									) : (
										// Reference number only: it shows in place of the photo on hover.
										<span className="cp-proof-blank cp-proof-ref">
											<span className="cp-proof-ref-hint">No photo</span>
											<b className="cp-proof-ref-number">{f.ref_number}</b>
										</span>
									)}
									<small className="cp-proof-meta">
										<span>{day(f.date_paid)}</span>
										{f.ref_number && <span>Ref. {f.ref_number}</span>}
									</small>
								</button>
							))}
						</div>
						{reviewing && (
							<>
								{reviewing.has_photo && <ProofPhoto id={reviewing.id} onAuthError={onAuthError} large />}
								<AddFee
									key={reviewing.id}
									ownerId={owner.id}
									proof={reviewing}
									onAdded={saved}
									onCancel={() => setReviewing(null)}
									onAuthError={onAuthError}
								/>
							</>
						)}
					</div>
				)}
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
								{paid.map((f) => (
									<tr key={f.id}>
										<td>{day(f.date_paid)}</td>
										<td>
											<span className={`cp-badge s-${f.type === 'subscription' ? 'laundry' : 'food'}`}>{f.type && TYPE_LABEL[f.type]}</span>
										</td>
										<td>
											{/* With a photo from the owner: click to see it. */}
											{f.has_photo ? (
												<button className="cp-link" onClick={() => setViewing(f)} title="View proof of payment">
													<b>{f.payment_type}</b>
												</button>
											) : (
												f.payment_type
											)}
											{f.ref_number && <small className="cp-sub">Ref. {f.ref_number}</small>}
										</td>
										<td className="num">{peso(f.amount)}</td>
										<td>{day(f.next_due_date)}</td>
									</tr>
								))}
								{paid.length === 0 && (
									<tr>
										<td colSpan={5} className="cp-empty">
											No payments yet
										</td>
									</tr>
								)}
							</tbody>
							{paid.length > 0 && (
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
				{viewing && (
					<div className="cp-modal-backdrop" onClick={(e) => (e.stopPropagation(), setViewing(null))}>
						<div className="cp-modal cp-photo-modal" role="dialog" aria-modal="true" aria-label="Proof of payment" onClick={(e) => e.stopPropagation()}>
							<div className="cp-modal-head">
								<h3>
									Proof of payment
									<small className="cp-sub">
										{day(viewing.date_paid)} · {peso(viewing.amount)} · {viewing.payment_type}
										{viewing.ref_number && <> · Ref. {viewing.ref_number}</>}
									</small>
								</h3>
								<button className="cp-btn-ghost cp-btn-xs" onClick={() => setViewing(null)} aria-label="Close">
									✕
								</button>
							</div>
							<ProofPhoto id={viewing.id} onAuthError={onAuthError} large />
						</div>
					</div>
				)}
				{adding ? (
					<AddFee ownerId={owner.id} onAdded={saved} onCancel={() => setAdding(false)} onAuthError={onAuthError} />
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

/** Records a payment, or with `proof` fills in one the owner sent (dated the day they sent it). */
function AddFee({
	ownerId,
	proof,
	onAdded,
	onCancel,
	onAuthError,
}: {
	ownerId: number;
	proof?: Fee;
	onAdded: (f: Fee) => void;
	onCancel: () => void;
	onAuthError: (e: unknown) => void;
}) {
	const [draft, setDraft] = useState(() => {
		const paidOn = proof?.date_paid ?? today();
		return { amount: '', type: 'subscription', payment_type: 'gcash', date_paid: paidOn, next_due_date: addMonth(paidOn) };
	});
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
			const res = await api<{ fee: Fee }>(proof ? `/admin/app-fee/${proof.id}` : `/admin/owners/${ownerId}/fees`, {
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
					{Object.entries(TYPE_LABEL).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
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
					{saving ? 'Saving…' : proof ? 'Save this payment' : 'Save payment'}
				</button>
			</div>
		</form>
	);
}

/** A proof photo the owner sent, loaded with the admin token. `large`: the full photo under the list. */
function ProofPhoto({ id, large = false, onAuthError }: { id: number; large?: boolean; onAuthError: (e: unknown) => void }) {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let objectUrl: string | null = null;
		apiBinary(`/admin/app-fee/${id}/photo`)
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
	if (!url) return <span className={large ? 'cp-proof-large cp-muted' : 'cp-proof-blank'}>…</span>;
	return <img src={url} alt="Proof of payment" className={large ? 'cp-proof-large' : 'cp-proof-thumb'} />;
}
