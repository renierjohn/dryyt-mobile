import { useEffect, useState } from 'react';
import { api } from './api';
import { useApi, type Page } from './useList';

type Owner = { id: number; name: string; email: string; phone: string; store_count: number; maxstore: number; blocked: number };

/** Stores tab "Owner" cell: the owner; click to hand the store to another owner. */
export function StoreOwnerCell({
	store,
	onAuthError,
}: {
	store: { id: number; name: string; owner_id: number | null; owner_name: string | null; owner_email: string | null };
	onAuthError: (e: unknown) => void;
}) {
	const [owner, setOwner] = useState({ id: store.owner_id, name: store.owner_name, email: store.owner_email });
	const [open, setOpen] = useState(false);
	useEffect(() => setOwner({ id: store.owner_id, name: store.owner_name, email: store.owner_email }), [store.owner_id, store.owner_name, store.owner_email]);

	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)} title="Change owner">
				{owner.name ? <b>{owner.name}</b> : <span className="cp-muted">No owner</span>}
				{owner.email && <small className="cp-sub">{owner.email}</small>}
			</button>
			{open && (
				<OwnerPicker
					store={store}
					currentId={owner.id}
					onClose={() => setOpen(false)}
					onPicked={(o) => {
						setOwner({ id: o.id, name: o.name, email: o.email });
						setOpen(false);
					}}
					onAuthError={onAuthError}
				/>
			)}
		</>
	);
}

function OwnerPicker({
	store,
	currentId,
	onClose,
	onPicked,
	onAuthError,
}: {
	store: { id: number; name: string };
	currentId: number | null;
	onClose: () => void;
	onPicked: (o: Owner) => void;
	onAuthError: (e: unknown) => void;
}) {
	const [search, setSearch] = useState('');
	const [q, setQ] = useState('');
	const [saving, setSaving] = useState<number | null>(null);
	const [error, setError] = useState('');
	const { data, loading } = useApi<Page<Owner>>('/admin/owners', { q, status: 'active' }, onAuthError);

	useEffect(() => {
		const t = setTimeout(() => setQ(search.trim()), 300);
		return () => clearTimeout(t);
	}, [search]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const pick = async (o: Owner) => {
		if (!confirm(`Give ${store.name} to ${o.name}? Its orders, drop offs and payouts go with it.`)) return;
		setSaving(o.id);
		setError('');
		try {
			await api(`/admin/stores/${store.id}/owner`, { body: { owner_id: o.id } });
			onPicked(o);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Request failed');
			onAuthError(e);
		} finally {
			setSaving(null);
		}
	};

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal" role="dialog" aria-modal="true" aria-label={`Owner · ${store.name}`} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					<h3>
						Change owner · {store.name}
						<small className="cp-sub">Owners at their store limit can't take another; raise Max stores on the Owners tab.</small>
					</h3>
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				<div className="cp-toolbar">
					<input type="search" placeholder="Search name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
				</div>
				{error && <p className="cp-error">{error}</p>}
				<div className={`cp-table-wrap ${loading ? 'loading' : ''}`}>
					<table className="cp-table">
						<thead>
							<tr>
								<th>Owner</th>
								<th className="num">Stores</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{data?.rows.map((o) => {
								const current = o.id === currentId;
								const full = o.store_count >= o.maxstore;
								return (
									<tr key={o.id}>
										<td>
											{o.name}
											<small className="cp-sub">
												{o.email} · {o.phone}
											</small>
										</td>
										<td className="num">
											{o.store_count} of {o.maxstore}
										</td>
										<td className="num">
											{current ? (
												<span className="cp-badge s-active">current</span>
											) : (
												<button className="cp-btn cp-btn-xs" disabled={full || saving !== null} title={full ? 'At their store limit' : undefined} onClick={() => pick(o)}>
													{saving === o.id ? '…' : full ? 'Full' : 'Choose'}
												</button>
											)}
										</td>
									</tr>
								);
							})}
							{data && data.rows.length === 0 && (
								<tr>
									<td colSpan={3} className="cp-empty">
										No owners found
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				{data && data.total > data.rows.length && <p className="cp-muted">Showing {data.rows.length} of {data.total}; search to narrow it down.</p>}
			</div>
		</div>
	);
}
