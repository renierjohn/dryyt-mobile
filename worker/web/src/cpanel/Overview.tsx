import { useState } from 'react';
import { peso } from './api';
import { defaultRange } from './dates';
import { useApi } from './useList';

type Counts = Record<string, number>;
type Stats = {
	users: Counts;
	orders: Counts;
	dropoffs: Counts;
	stores: Counts;
	orders_gross: number;
	dropoffs_gross: number;
	orders_service_fees: number;
	dropoffs_service_fees: number;
	app_fee: number;
	drivers_online: number;
};

const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

function Breakdown({ title, counts }: { title: string; counts: Counts }) {
	const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return (
		<section className="cp-card">
			<h3>
				{title} <span className="cp-muted">{sum(counts)}</span>
			</h3>
			{entries.length === 0 ? (
				<p className="cp-muted">None yet</p>
			) : (
				<ul className="cp-breakdown">
					{entries.map(([k, v]) => (
						<li key={k}>
							<span className={`cp-badge s-${k}`}>{k.replaceAll('_', ' ')}</span>
							<b>{v}</b>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export default function Overview({ onAuthError }: { onAuthError: (e: unknown) => void }) {
	const [range] = useState(defaultRange);
	const [from, setFrom] = useState(range.from);
	const [to, setTo] = useState(range.to);
	const { data, error } = useApi<Stats>('/admin/stats', { from, to }, onAuthError);
	if (!data) return error ? <p className="cp-error">{error}</p> : <p className="cp-muted">Loading…</p>;

	const tiles = [
		{ label: 'Users', value: sum(data.users) },
		{ label: 'Drivers online', value: data.drivers_online },
		{ label: 'Pickup gross (delivered)', value: peso(data.orders_gross) },
		{ label: 'Drop off gross (completed)', value: peso(data.dropoffs_gross) },
		{ label: 'Pickup service fees', value: peso(data.orders_service_fees) },
		{ label: 'Drop off service fees', value: peso(data.dropoffs_service_fees) },
		{ label: 'APP service fee', value: peso(data.app_fee) },
		{ label: 'Total service fees', value: peso(data.orders_service_fees + data.dropoffs_service_fees) },
	];
	return (
		<>
			<h1 className="cp-title">Overview</h1>
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
				<small className="cp-muted">{from || to ? `Amounts for ${from || 'the start'} to ${to || 'today'} (Manila time)` : 'Amounts for all time'}</small>
			</div>
			{error && <p className="cp-error">{error}</p>}
			<div className="cp-tiles">
				{tiles.map((t) => (
					<div key={t.label} className="cp-tile">
						<small>{t.label}</small>
						<strong>{t.value}</strong>
					</div>
				))}
			</div>
			<div className="cp-grid">
				<Breakdown title="Pickup orders" counts={data.orders} />
				<Breakdown title="Drop offs" counts={data.dropoffs} />
				<Breakdown title="Users" counts={data.users} />
				<Breakdown title="Stores" counts={data.stores} />
			</div>
		</>
	);
}
