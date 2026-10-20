import { useEffect, useState } from 'react';
import { api, peso } from './api';

/** Same lists as worker/src/lib/fees.ts RATE_TYPES and VEHICLE_CATEGORIES. */
const TYPES = ['dropoff', 'pickup'] as const;
const CATEGORIES = [2, 1, 3, 4] as const;
const TYPE_LABEL: Record<string, string> = { dropoff: 'Drop off', pickup: 'Pickup' };
const CATEGORY_LABEL: Record<number, string> = { 1: 'Bicycle', 2: 'Motorcycle', 3: 'Tricycle', 4: 'Car (lightweight)' };

type Rate = {
	id?: number;
	group_id: string;
	type: string;
	category: number;
	base_fee: number;
	rate_per_km: number;
	commission_pct: number;
	store_count?: number;
};
const rateKey = (r: Pick<Rate, 'group_id' | 'type' | 'category'>) => `${r.group_id}/${r.type}/${r.category}`;

/** Same formula as worker/src/lib/fees.ts computeFees: each amount rounded up to a whole peso. */
const roundUpToPeso = (centavos: number) => Math.ceil(Math.round(centavos) / 100) * 100;
function feesFor(km: number, r: Rate) {
	const delivery = roundUpToPeso(r.base_fee + km * r.rate_per_km);
	const service = roundUpToPeso((delivery * r.commission_pct) / 100);
	return { delivery, service, total: delivery + service };
}

const SAMPLE_KM = [1, 3, 5, 10];

/** Form values are pesos as typed; the API takes centavos. */
type Draft = { group_id: string; type: string; category: string; base_fee: string; rate_per_km: string; commission_pct: string };
const toDraft = (r: Rate): Draft => ({
	group_id: r.group_id,
	type: r.type,
	category: String(r.category),
	base_fee: String(r.base_fee / 100),
	rate_per_km: String(r.rate_per_km / 100),
	commission_pct: String(r.commission_pct),
});
const fromDraft = (d: Draft): Rate => ({
	group_id: d.group_id.trim().toLowerCase(),
	type: d.type,
	category: Number(d.category),
	base_fee: Math.round(Number(d.base_fee) * 100),
	rate_per_km: Math.round(Number(d.rate_per_km) * 100),
	commission_pct: Number(d.commission_pct),
});
const valid = (d: Draft) =>
	[d.base_fee, d.rate_per_km, d.commission_pct].every((v) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0) &&
	Number(d.commission_pct) <= 100 &&
	/^[a-z0-9_-]{1,40}$/.test(d.group_id.trim().toLowerCase());

function RateCard({
	rate,
	isNew,
	onSaved,
	onDeleted,
	onCancel,
	onAuthError,
}: {
	rate: Rate;
	isNew?: boolean;
	onSaved: (r: Rate) => void;
	onDeleted?: (id: number) => void;
	onCancel?: () => void;
	onAuthError: (e: unknown) => void;
}) {
	const [draft, setDraft] = useState(() => toDraft(rate));
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
	useEffect(() => setDraft(toDraft(rate)), [rate]);

	const dirty = isNew || JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(rate)));
	const ok = valid(draft);
	const preview = ok ? fromDraft(draft) : null;
	const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		setDraft({ ...draft, [k]: e.target.value });
		setMsg(null);
	};

	const save = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!ok) return;
		const next = fromDraft(draft);
		const sc = rate.store_count ?? 0;
		if (!isNew && !confirm(`Update the ${TYPE_LABEL[next.type]} · ${CATEGORY_LABEL[next.category] ?? `Vehicle ${next.category}`} rate for "${next.group_id}"? New bookings from ${sc} store${sc === 1 ? '' : 's'} will use them right away.`)) return;
		setSaving(true);
		try {
			// New rates upsert by area, service and vehicle; existing ones are edited by id, so their service or vehicle can change.
			const res = isNew || rate.id === undefined
				? await api<{ rate: Rate }>('/admin/rates', { body: next })
				: await api<{ rate: Rate }>(`/admin/rates/${rate.id}`, { body: next });
			onSaved({ ...res.rate, store_count: rate.store_count ?? 0 });
			setMsg({ ok: true, text: 'Saved' });
		} catch (err) {
			setMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' });
			onAuthError(err);
		} finally {
			setSaving(false);
		}
	};

	// Bookings price with the area's motorcycle rates, so those stay while any store is in the area (the worker checks too).
	const deletable = !isNew && rate.id !== undefined && (rate.category !== 2 || (rate.store_count ?? 0) === 0);
	const remove = async () => {
		if (rate.id === undefined) return;
		if (!confirm(`Delete the ${TYPE_LABEL[rate.type]} · ${CATEGORY_LABEL[rate.category] ?? `Vehicle ${rate.category}`} rate for "${rate.group_id}"?`)) return;
		setSaving(true);
		try {
			await api(`/admin/rates/${rate.id}/delete`, { body: {} });
			onDeleted?.(rate.id);
		} catch (err) {
			setMsg({ ok: false, text: err instanceof Error ? err.message : 'Delete failed' });
			onAuthError(err);
			setSaving(false);
		}
	};

	return (
		<form className="cp-card cp-rate" onSubmit={save}>
			<div className="cp-rate-head">
				{isNew ? (
					<label className="cp-field">
						Area ID
						<input value={draft.group_id} onChange={set('group_id')} placeholder="e.g. dumaguete" autoFocus />
					</label>
				) : (
					<h3>
						{rate.group_id}{' '}
						<span className="cp-muted">
							· {rate.store_count} store{rate.store_count === 1 ? '' : 's'}
						</span>
					</h3>
				)}
				<div className="cp-rate-fields">
					<label className="cp-field">
						Service
						<select value={draft.type} onChange={set('type')}>
							{TYPES.map((t) => (
								<option key={t} value={t}>
									{TYPE_LABEL[t]}
								</option>
							))}
						</select>
					</label>
					<label className="cp-field">
						Vehicle
						<select value={draft.category} onChange={set('category')}>
							{CATEGORIES.map((c) => (
								<option key={c} value={c}>
									{CATEGORY_LABEL[c]}
								</option>
							))}
						</select>
					</label>
				</div>
			</div>
			<div className="cp-rate-fields">
				<label className="cp-field">
					Base fee (₱)
					<input type="number" min={0} step="0.01" value={draft.base_fee} onChange={set('base_fee')} />
				</label>
				<label className="cp-field">
					Per km (₱)
					<input type="number" min={0} step="0.01" value={draft.rate_per_km} onChange={set('rate_per_km')} />
				</label>
				<label className="cp-field">
					Service fee (%)
					<input type="number" min={0} max={100} step="0.1" value={draft.commission_pct} onChange={set('commission_pct')} />
				</label>
			</div>
			<table className="cp-preview">
				<thead>
					<tr>
						<th>Distance</th>
						<th className="num">Delivery</th>
						<th className="num">Service</th>
						<th className="num">Customer pays</th>
					</tr>
				</thead>
				<tbody>
					{SAMPLE_KM.map((km) => {
						const f = preview && feesFor(km, preview);
						return (
							<tr key={km}>
								<td>{km} km</td>
								<td className="num">{f ? peso(f.delivery) : '—'}</td>
								<td className="num">{f ? peso(f.service) : '—'}</td>
								<td className="num">
									<b>{f ? peso(f.total) : '—'}</b>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<div className="cp-rate-actions">
				{msg && <span className={msg.ok ? 'cp-ok' : 'cp-error-inline'}>{msg.text}</span>}
				{!ok && <span className="cp-error-inline">Check the values</span>}
				{deletable && (
					<button type="button" className="cp-btn-ghost cp-btn-danger" disabled={saving} onClick={remove}>
						Delete
					</button>
				)}
				{onCancel && (
					<button type="button" className="cp-btn-ghost" onClick={onCancel}>
						Cancel
					</button>
				)}
				{!isNew && dirty && (
					<button type="button" className="cp-btn-ghost" onClick={() => setDraft(toDraft(rate))}>
						Reset
					</button>
				)}
				<button className="cp-btn cp-btn-sm" disabled={!ok || !dirty || saving}>
					{saving ? 'Saving…' : isNew ? 'Add rate' : 'Save'}
				</button>
			</div>
		</form>
	);
}

export default function Rates({ onAuthError }: { onAuthError: (e: unknown) => void }) {
	const [rates, setRates] = useState<Rate[] | null>(null);
	const [error, setError] = useState('');
	const [adding, setAdding] = useState(false);

	useEffect(() => {
		api<{ rates: Rate[] }>('/admin/rates')
			.then((r) => setRates(r.rates))
			.catch((e) => {
				setError(e instanceof Error ? e.message : 'Request failed');
				onAuthError(e);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Matched by id, so an edited service or vehicle replaces its card; a new rate that upserted an existing one too.
	const saved = (r: Rate) =>
		setRates((list) =>
			list?.some((x) => x.id === r.id)
				? list.map((x) => (x.id === r.id ? { ...r, store_count: x.store_count } : x))
				: [...(list ?? []), r],
		);

	return (
		<>
			<div className="cp-title-row">
				<h1 className="cp-title">Delivery rates</h1>
				{!adding && rates && (
					<button className="cp-btn cp-btn-sm" onClick={() => setAdding(true)}>
						+ Add rate
					</button>
				)}
			</div>
			<p className="cp-muted cp-note">
				Fee = base fee + distance × per-km rate, plus the service fee %. Each amount is rounded up to a whole peso. Changes apply to new
				bookings right away; orders already placed keep their fees. Stores use the rate of their area (group); pickups and drop offs each have their own rate per vehicle. Bookings use the motorcycle rate for now.
			</p>
			{error && <p className="cp-error">{error}</p>}
			{!rates && !error && <p className="cp-muted">Loading…</p>}
			<div className="cp-rates">
				{adding && (
					<RateCard
						isNew
						rate={{ group_id: '', type: 'dropoff', category: 2, base_fee: 4000, rate_per_km: 1000, commission_pct: 10, store_count: 0 }}
						onSaved={(r) => {
							saved(r);
							setAdding(false);
						}}
						onCancel={() => setAdding(false)}
						onAuthError={onAuthError}
					/>
				)}
				{rates?.map((r) => <RateCard key={r.id ?? rateKey(r)} rate={r} onSaved={saved} onDeleted={(id) => setRates((list) => list?.filter((x) => x.id !== id) ?? list)} onAuthError={onAuthError} />)}
			</div>
		</>
	);
}
