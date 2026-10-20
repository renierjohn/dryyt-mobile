import { useEffect, useState } from 'react';
import { api, peso } from './api';
import { defaultRange } from './dates';
import { useApi } from './useList';

type Store = {
	id: number;
	name: string;
	type: string;
	address: string;
	group_id: string;
	store_logo: string | null;
	service_fee: number;
	sales: number;
	app_fee: number;
	fee_type: 1 | 2;
	fee_flat: number;
	fee_percentage: number;
	order_count: number;
	dropoff_count: number;
};
type FeeSettings = { fee_type: 1 | 2; fee_flat: number; fee_percentage: number };
type StoresResponse = { stores: Store[]; total_service_fee: number; total_app_fee: number; maxstore: number };

/** A store's app fee, with how it was worked out (users.fee_type 1 flat, 2 percentage of sales). */
export function AppFee({ row }: { row: Pick<Store, 'app_fee' | 'fee_type' | 'fee_percentage'> }) {
	return (
		<>
			{peso(row.app_fee)}
			<small className="cp-sub">{row.fee_type === 2 ? `${row.fee_percentage}% of sales` : 'flat'}</small>
		</>
	);
}
type Owner = { id: number; name: string; store_names: string | null; store_count: number; maxstore: number };

/** Owners tab "Stores" cell: names and "n of max"; opens the owner's stores with their service fees. */
export function OwnerStoresCell({ owner, onAuthError }: { owner: Owner; onAuthError: (e: unknown) => void }) {
	const [open, setOpen] = useState(false);
	const [max, setMax] = useState(owner.maxstore);
	useEffect(() => setMax(owner.maxstore), [owner.maxstore]);

	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)}>
				{owner.store_names ? <b>{owner.store_names}</b> : <span className="cp-muted">No stores</span>}
				<small className="cp-sub">
					{owner.store_count} of {max} store{max === 1 ? '' : 's'}
				</small>
			</button>
			{open && <StoresModal owner={owner} max={max} onMax={setMax} onClose={() => setOpen(false)} onAuthError={onAuthError} />}
		</>
	);
}

function StoresModal({
	owner,
	max,
	onMax,
	onClose,
	onAuthError,
}: {
	owner: Owner;
	max: number;
	onMax: (n: number) => void;
	onClose: () => void;
	onAuthError: (e: unknown) => void;
}) {
	const [range] = useState(defaultRange);
	const [from, setFrom] = useState(range.from);
	const [to, setTo] = useState(range.to);
	// Bumped after a store's fee changes, to fetch the app fees and totals again.
	const [version, setVersion] = useState(0);
	const { data, error, loading } = useApi<StoresResponse>(`/admin/owners/${owner.id}/stores`, { from, to, v: version || '' }, onAuthError);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal cp-modal-wide" role="dialog" aria-modal="true" aria-label={`Stores · ${owner.name}`} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					<h3>Stores · {owner.name}</h3>
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				<MaxStore ownerId={owner.id} max={max} count={data?.stores.length ?? owner.store_count} onSaved={onMax} onAuthError={onAuthError} />
				<div className="cp-toolbar cp-range">
					<label className="cp-field">
						From
						<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
					</label>
					<label className="cp-field">
						To
						<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
					</label>
					{(from || to) && (
						<button
							className="cp-btn-ghost"
							onClick={() => {
								setFrom('');
								setTo('');
							}}
						>
							All time
						</button>
					)}
				</div>
				{error && <p className="cp-error">{error}</p>}
				{!data && !error && <p className="cp-muted">Loading…</p>}
				{data && (
					<>
						<div className="cp-summary">
							Total service fee <b>{peso(data.total_service_fee)}</b>
							<span className="cp-summary-sep" />
							Total app fee <b>{peso(data.total_app_fee)}</b>
						</div>
						<div className={`cp-table-wrap ${loading ? 'loading' : ''}`}>
							<table className="cp-table">
								<thead>
									<tr>
										<th>Store</th>
										<th>Type</th>
										<th className="num">Service Fee</th>
										<th className="num">Sales</th>
										<th className="num">App Fee</th>
										<th>Fee setting</th>
										<th className="num">Orders</th>
										<th className="num">Drop offs</th>
									</tr>
								</thead>
								<tbody>
									{data.stores.map((s) => (
										<tr key={s.id}>
											<td>
												<span className="cp-store">
													{s.store_logo ? <img src={s.store_logo} alt="" /> : <span className="cp-logo-blank" />}
													<span>
														{s.name}
														<small className="cp-sub">{s.address}</small>
													</span>
												</span>
											</td>
											<td>
												<span className={`cp-badge s-${s.type}`}>{s.type}</span>
											</td>
											<td className="num">{peso(s.service_fee)}</td>
											<td className="num">{peso(s.sales)}</td>
											<td className="num">
												<AppFee row={s} />
											</td>
											<td>
												<StoreFeeForm store={s} onSaved={() => setVersion((v) => v + 1)} onAuthError={onAuthError} />
											</td>
											<td className="num">{s.order_count}</td>
											<td className="num">{s.dropoff_count}</td>
										</tr>
									))}
									{data.stores.length === 0 && (
										<tr>
											<td colSpan={8} className="cp-empty">
												No stores yet
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

/** Edits users.maxstore: how many stores the owner may run. */
function MaxStore({ ownerId, max, count, onSaved, onAuthError }: { ownerId: number; max: number; count: number; onSaved: (n: number) => void; onAuthError: (e: unknown) => void }) {
	const [value, setValue] = useState(String(max));
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	useEffect(() => setValue(String(max)), [max]);

	const n = Number(value);
	const ok = value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 100;

	const save = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!ok || n === max) return;
		setSaving(true);
		try {
			const res = await api<{ maxstore: number }>(`/admin/owners/${ownerId}/maxstore`, { body: { maxstore: n } });
			onSaved(res.maxstore);
			setMsg({ ok: true, text: 'Saved' });
		} catch (err) {
			setMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' });
			onAuthError(err);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form className="cp-maxstore" onSubmit={save}>
			<label className="cp-field">
				Max stores
				<input
					type="number"
					min={0}
					max={100}
					step={1}
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						setMsg(null);
					}}
				/>
			</label>
			<button className="cp-btn cp-btn-sm" disabled={!ok || n === max || saving}>
				{saving ? 'Saving…' : 'Update'}
			</button>
			{msg && <span className={msg.ok ? 'cp-ok' : 'cp-error-inline'}>{msg.text}</span>}
			{ok && n < count && <span className="cp-muted">Below their {count} stores: they keep them but can't add more.</span>}
		</form>
	);
}


/** One store's app fee: flat (pesos) or a percentage of its sales. Saves to /admin/stores/:id/fee. */
function StoreFeeForm({ store, onSaved, onAuthError }: { store: FeeSettings & { id: number }; onSaved: () => void; onAuthError: (e: unknown) => void }) {
	const toDraft = (f: FeeSettings) => ({ fee_type: String(f.fee_type), amount: String(f.fee_type === 2 ? f.fee_percentage : f.fee_flat / 100) });
	const key = `${store.fee_type}|${store.fee_flat}|${store.fee_percentage}`;
	const [draft, setDraft] = useState(() => toDraft(store));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	// eslint-disable-next-line react-hooks/exhaustive-deps
	useEffect(() => setDraft(toDraft(store)), [key]);

	const pct = draft.fee_type === '2';
	const n = Number(draft.amount);
	const ok = draft.amount.trim() !== '' && Number.isFinite(n) && n >= 0 && (!pct || n <= 100);
	// Only the chosen kind changes; the other keeps its saved value.
	const next: FeeSettings = pct
		? { fee_type: 2, fee_flat: store.fee_flat, fee_percentage: n }
		: { fee_type: 1, fee_flat: Math.round(n * 100), fee_percentage: store.fee_percentage };
	const dirty = `${next.fee_type}|${next.fee_flat}|${next.fee_percentage}` !== key;

	const save = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!ok || !dirty) return;
		setSaving(true);
		setError('');
		try {
			await api(`/admin/stores/${store.id}/fee`, { body: next });
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed');
			onAuthError(err);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form className="cp-store-fee" onSubmit={save}>
			<select
				aria-label="Fee type"
				value={draft.fee_type}
				onChange={(e) => setDraft({ fee_type: e.target.value, amount: String(e.target.value === '2' ? store.fee_percentage : store.fee_flat / 100) })}
			>
				<option value="1">Flat ₱</option>
				<option value="2">% of sales</option>
			</select>
			<input
				aria-label={pct ? 'Percentage' : 'Flat fee in pesos'}
				type="number"
				min={0}
				max={pct ? 100 : undefined}
				step={pct ? '0.1' : '0.01'}
				value={draft.amount}
				onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
			/>
			<button className="cp-btn cp-btn-xs" disabled={!ok || !dirty || saving}>
				{saving ? '…' : 'Save'}
			</button>
			{error && <span className="cp-error-inline">{error}</span>}
		</form>
	);
}
