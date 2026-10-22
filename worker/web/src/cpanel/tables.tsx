import { useEffect, useState, type ReactNode } from 'react';
import { api, peso, when } from './api';
import { defaultRange } from './dates';
import { AppFee, OwnerStoresCell } from './OwnerStores';
import { LicenseModal } from './PhotoEditor';
import { OrderItemsCell } from './OrderItems';
import { StoreDetailsCell } from './StoreDetails';
import { StoreOwnerCell } from './StoreOwner';
import { SubscriptionCell } from './Subscription';
import { useApi, type Page } from './useList';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Column = { label: string; cell: (r: Row) => ReactNode; className?: string };

const badge = (s: string) => <span className={`cp-badge s-${s}`}>{s.replaceAll('_', ' ')}</span>;

function DataTable({
	title,
	path,
	filterParam,
	filterOptions,
	searchPlaceholder,
	columns,
	onAuthError,
	dateRange,
	summary,
	extraFilters = [],
}: {
	title: string;
	path: string;
	filterParam: string;
	filterOptions: string[];
	searchPlaceholder: string;
	columns: Column[];
	onAuthError: (e: unknown) => void;
	/** Adds From/To date inputs after the search; sent as ?from=&to= (YYYY-MM-DD). */
	dateRange?: boolean;
	/** Shown above the table, from the whole response (e.g. a total the API adds next to `rows`). */
	summary?: (data: Page<Row> & Row) => ReactNode;
	/** More dropdowns after the search (before the dates), each sent as `?<param>=<value>` ('' = all). */
	extraFilters?: { param: string; label: string; options: { value: string; label: string }[] }[];
}) {
	const [filter, setFilter] = useState('');
	const [search, setSearch] = useState('');
	const [q, setQ] = useState('');
	const [page, setPage] = useState(1);
	const [range] = useState(defaultRange);
	const [from, setFrom] = useState(range.from);
	const [to, setTo] = useState(range.to);
	const [extra, setExtra] = useState<Record<string, string>>({});

	// Debounce typing so each keystroke doesn't hit the API.
	useEffect(() => {
		const t = setTimeout(() => {
			setQ(search.trim());
			setPage(1);
		}, 300);
		return () => clearTimeout(t);
	}, [search]);

	const { data, error, loading } = useApi<Page<Row> & Row>(path, { [filterParam]: filter, q, page, from, to, ...extra }, onAuthError);
	const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

	return (
		<>
			<h1 className="cp-title">
				{title} {data && <span className="cp-muted">{data.total}</span>}
			</h1>
			<div className="cp-toolbar">
				<input type="search" placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
				{extraFilters.map((f) => (
					<select
						key={f.param}
						aria-label={f.label}
						value={extra[f.param] ?? ''}
						onChange={(e) => {
							setExtra({ ...extra, [f.param]: e.target.value });
							setPage(1);
						}}
					>
						<option value="">All {f.label.toLowerCase()}s</option>
						{f.options.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				))}
				{dateRange && (
					<>
						<input
							type="date"
							className="cp-date"
							aria-label="From"
							value={from}
							max={to || undefined}
							onChange={(e) => {
								setFrom(e.target.value);
								setPage(1);
							}}
						/>
						<input
							type="date"
							className="cp-date"
							aria-label="To"
							value={to}
							min={from || undefined}
							onChange={(e) => {
								setTo(e.target.value);
								setPage(1);
							}}
						/>
					</>
				)}
				<select
					value={filter}
					onChange={(e) => {
						setFilter(e.target.value);
						setPage(1);
					}}
				>
					<option value="">All</option>
					{filterOptions.map((o) => (
						<option key={o} value={o}>
							{o.replaceAll('_', ' ')}
						</option>
					))}
				</select>
			</div>
			{error && <p className="cp-error">{error}</p>}
			{summary && data && <div className="cp-summary">{summary(data)}</div>}
			<div className={`cp-table-wrap ${loading ? 'loading' : ''}`}>
				<table className="cp-table">
					<thead>
						<tr>
							{columns.map((c) => (
								<th key={c.label} className={c.className}>
									{c.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{data?.rows.map((r) => (
							<tr key={r.id}>
								{columns.map((c) => (
									<td key={c.label} className={c.className}>
										{c.cell(r)}
									</td>
								))}
							</tr>
						))}
						{data && data.rows.length === 0 && (
							<tr>
								<td colSpan={columns.length} className="cp-empty">
									Nothing found
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			<div className="cp-pager">
				<button disabled={page <= 1} onClick={() => setPage(page - 1)}>
					‹ Prev
				</button>
				<span>
					Page {page} of {pages}
				</span>
				<button disabled={page >= pages} onClick={() => setPage(page + 1)}>
					Next ›
				</button>
			</div>
		</>
	);
}

type Props = { onAuthError: (e: unknown) => void };

const ORDER_STATUSES = ['awaiting_fee', 'to_pay', 'awaiting_payment', 'payment_confirmed', 'pending', 'accepted', 'picked_up', 'delivered', 'cancelled'];
const DROPOFF_STATUSES = ['searching', 'driver_accepted', 'en_route_pickup', 'en_route_shop', 'dropped_off', 'owner_confirmed', 'completed', 'payment_pending', 'cancelled', 'expired'];

const person = (name: string | null, sub?: string | null) =>
	name ? (
		<>
			{name}
			{sub && <small className="cp-sub">{sub}</small>}
		</>
	) : (
		<span className="cp-muted">—</span>
	);

/** Fee totals the orders and drop offs lists add next to `rows` (cancelled/expired left out). */
const feeTotals = (d: Row) => (
	<>
		Total delivery fee <b>{peso(d.total_delivery_fee)}</b>
		<span className="cp-summary-sep" />
		Total service fee <b>{peso(d.total_service_fee)}</b>
	</>
);

export function OrdersTable({ onAuthError }: Props) {
	return (
		<DataTable
			title="Pickup orders"
			path="/admin/orders"
			filterParam="status"
			filterOptions={ORDER_STATUSES}
			searchPlaceholder="Search customer name or email"
			onAuthError={onAuthError}
			dateRange
			summary={feeTotals}
			columns={[
				{ label: '#', cell: (r) => r.id },
				{ label: 'Status', cell: (r) => badge(r.status) },
				{ label: 'Store', cell: (r) => person(r.store_name, r.store_type) },
				{ label: 'Customer', cell: (r) => person(r.customer_name, r.customer_phone) },
				{ label: 'Driver', cell: (r) => person(r.driver_name) },
				{
					label: 'Items',
					cell: (r) => (
						<OrderItemsCell id={r.id} onAuthError={onAuthError}>
							{peso(r.items_total)}
						</OrderItemsCell>
					),
					className: 'num',
				},
				{ label: 'Fees', cell: (r) => peso(r.total_delivery_fee), className: 'num' },
				{ label: 'Service fee', cell: (r) => peso(r.service_fee), className: 'num' },
				{ label: 'Total', cell: (r) => <b>{peso(r.items_total + r.total_delivery_fee)}</b>, className: 'num' },
				{ label: 'Created', cell: (r) => when(r.created_at) },
			]}
		/>
	);
}

export function DropoffsTable({ onAuthError }: Props) {
	return (
		<DataTable
			title="Drop offs"
			path="/admin/dropoffs"
			filterParam="status"
			filterOptions={DROPOFF_STATUSES}
			searchPlaceholder="Search customer name or email"
			onAuthError={onAuthError}
			dateRange
			summary={feeTotals}
			columns={[
				{ label: '#', cell: (r) => r.id },
				{ label: 'Status', cell: (r) => badge(r.status) },
				{ label: 'Shop', cell: (r) => r.store_name },
				{ label: 'Customer', cell: (r) => person(r.customer_name, r.customer_phone) },
				{ label: 'Driver', cell: (r) => person(r.driver_name) },
				{ label: 'Km', cell: (r) => r.road_km?.toFixed(1), className: 'num' },
				{ label: 'Delivery', cell: (r) => peso(r.total_delivery_fee), className: 'num' },
				{ label: 'Service fee', cell: (r) => peso(r.service_fee), className: 'num' },
				{ label: 'Laundry', cell: (r) => peso(r.laundry_fee), className: 'num' },
				{ label: 'Created', cell: (r) => when(r.created_at) },
			]}
		/>
	);
}

/** Blocks or unblocks the account; a blocked user can't sign in. Keeps its own state so the table needn't reload. */
function BlockButton({ id, blocked, onAuthError }: { id: number; blocked: number; onAuthError: (e: unknown) => void }) {
	const [isBlocked, setBlocked] = useState(blocked === 1);
	const [busy, setBusy] = useState(false);
	useEffect(() => setBlocked(blocked === 1), [blocked]);

	const toggle = async () => {
		const next = !isBlocked;
		if (next && !confirm(`Block user #${id}? They won't be able to sign in.`)) return;
		setBusy(true);
		try {
			const res = await api<{ user: { blocked: number } }>(`/admin/users/${id}/blocked`, { body: { blocked: next } });
			setBlocked(res.user.blocked === 1);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Request failed');
			onAuthError(e);
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			{isBlocked && badge('blocked')}{' '}
			<button className="cp-btn-ghost cp-btn-xs" disabled={busy} onClick={toggle}>
				{isBlocked ? 'Unblock' : 'Block'}
			</button>
		</>
	);
}

/** driver_data.vehicle_type codes, same as worker/src/lib/fees.ts VEHICLE_CATEGORIES. */
const VEHICLE_LABEL: Record<number, string> = { 1: 'Bicycle', 2: 'Motorcycle', 3: 'Tricycle', 4: 'Car (lightweight)' };

/** Drivers tab "License" cell: opens the photo editor and verified switch; shows the verified state it last set. */
function LicenseCell({ driver, onAuthError }: { driver: Row; onAuthError: (e: unknown) => void }) {
	const [open, setOpen] = useState(false);
	const [verified, setVerified] = useState<number>(driver.verified);
	useEffect(() => setVerified(driver.verified), [driver.verified]);
	if (!driver.has_id) return yesNo(0);
	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)}>
				<b>View</b>
				<small className="cp-sub">{verified === 1 ? 'verified' : 'not verified'}</small>
			</button>
			{open && (
				<LicenseModal
					driver={{ id: driver.id, name: driver.name, verified }}
					onClose={() => setOpen(false)}
					onVerified={(v) => setVerified(v ? 1 : 0)}
					onAuthError={onAuthError}
				/>
			)}
		</>
	);
}

/** Areas with rates, fetched once per page load for every Group cell. */
let groupsRequest: Promise<string[]> | null = null;
const loadGroups = () => (groupsRequest ??= api<{ groups: string[] }>('/admin/groups').then((r) => r.groups));

/** Stores tab "Group" cell: click to move the store to another area (one with rates). */
function GroupCell({ store, onAuthError }: { store: Row; onAuthError: (e: unknown) => void }) {
	const [group, setGroup] = useState<string>(store.group_id);
	const [groups, setGroups] = useState<string[] | null>(null);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	useEffect(() => setGroup(store.group_id), [store.group_id]);

	const open = () => {
		setEditing(true);
		loadGroups()
			.then(setGroups)
			.catch((e) => {
				groupsRequest = null;
				setEditing(false);
				alert(e instanceof Error ? e.message : 'Request failed');
				onAuthError(e);
			});
	};

	const pick = async (next: string) => {
		if (next === group) return setEditing(false);
		if (!confirm(`Move ${store.name} to "${next}"? It will use that area's rates and drivers from new bookings on.`)) return;
		setSaving(true);
		try {
			const res = await api<{ group_id: string }>(`/admin/stores/${store.id}/group`, { body: { group_id: next } });
			setGroup(res.group_id);
			setEditing(false);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Request failed');
			onAuthError(e);
		} finally {
			setSaving(false);
		}
	};

	if (!editing) {
		return (
			<button className="cp-link" onClick={open} title="Change area">
				<b>{group}</b>
			</button>
		);
	}
	if (!groups) return <span className="cp-muted">Loading…</span>;
	return (
		<span className="cp-store-fee">
			<select aria-label="Area" value={group} disabled={saving} autoFocus onChange={(e) => pick(e.target.value)}>
				{/* Keep the current area listed even if its rates were removed. */}
				{(groups.includes(group) ? groups : [group, ...groups]).map((g) => (
					<option key={g} value={g}>
						{g}
					</option>
				))}
			</select>
			<button className="cp-btn-ghost cp-btn-xs" disabled={saving} onClick={() => setEditing(false)}>
				Cancel
			</button>
		</span>
	);
}

const yesNo = (v: number | boolean) => (v ? '✓' : <span className="cp-muted">—</span>);

export function DriversTable({ onAuthError }: Props) {
	return (
		<DataTable
			title="Drivers"
			path="/admin/drivers"
			filterParam="status"
			filterOptions={['verified', 'unverified', 'online', 'blocked']}
			searchPlaceholder="Search name, email or phone"
			onAuthError={onAuthError}
			columns={[
				{ label: '#', cell: (r) => r.id },
				{ label: 'Name', cell: (r) => person(r.name, r.email) },
				{ label: 'Phone', cell: (r) => r.phone },
				{
					label: 'Status',
					cell: (r) => (
						<>
							{r.online ? badge(r.busy ? 'busy' : 'online') : badge('offline')} {r.verified === 1 ? badge('verified') : badge('unverified')}
						</>
					),
				},
				{ label: 'Face', cell: (r) => (r.has_face ? <>✓{r.face_check && <small className="cp-sub">{r.face_check}</small>}</> : yesNo(0)), className: 'num' },
				{ label: 'License', cell: (r) => <LicenseCell driver={r} onAuthError={onAuthError} />, className: 'num' },
				{ label: 'Vehicle', cell: (r) => VEHICLE_LABEL[r.vehicle_type] ?? <span className="cp-muted">—</span> },
				{ label: 'Notes', cell: (r) => r.notes || <span className="cp-muted">—</span> },
				{ label: 'Earnings', cell: (r) => peso(r.earnings), className: 'num' },
				{ label: 'Last seen', cell: (r) => (r.seen_at ? when(r.seen_at) : <span className="cp-muted">—</span>) },
				{ label: 'Joined', cell: (r) => when(r.created_at) },
				{ label: 'Access', cell: (r) => <BlockButton id={r.id} blocked={r.blocked} onAuthError={onAuthError} /> },
			]}
		/>
	);
}

export function UsersTable({ onAuthError }: Props) {
	return (
		<DataTable
			title="Customers"
			path="/admin/customers"
			filterParam="status"
			filterOptions={['active', 'blocked']}
			searchPlaceholder="Search name, email or phone"
			onAuthError={onAuthError}
			columns={[
				{ label: '#', cell: (r) => r.id },
				{ label: 'Name', cell: (r) => person(r.name, r.email) },
				{ label: 'Phone', cell: (r) => r.phone },
				{ label: 'Orders', cell: (r) => r.order_count, className: 'num' },
				{ label: 'Drop offs', cell: (r) => r.dropoff_count, className: 'num' },
				{ label: 'Joined', cell: (r) => when(r.created_at) },
				{ label: 'Access', cell: (r) => <BlockButton id={r.id} blocked={r.blocked} onAuthError={onAuthError} /> },
			]}
		/>
	);
}

export function OwnersTable({ onAuthError }: Props) {
	return (
		<DataTable
			title="Owners"
			path="/admin/owners"
			filterParam="status"
			filterOptions={['active', 'blocked']}
			searchPlaceholder="Search name, email or phone"
			onAuthError={onAuthError}
			columns={[
				{ label: '#', cell: (r) => r.id },
				{
					label: 'Name',
					cell: (r) => (
						<>
							{person(r.name, r.email)} {r.is_admin === 1 && badge('admin')}
						</>
					),
				},
				{ label: 'Phone', cell: (r) => r.phone },
				{ label: 'Stores', cell: (r) => <OwnerStoresCell owner={r as Parameters<typeof OwnerStoresCell>[0]['owner']} onAuthError={onAuthError} /> },
				{ label: 'Subscription', cell: (r) => <SubscriptionCell owner={r as Parameters<typeof SubscriptionCell>[0]['owner']} onAuthError={onAuthError} /> },
				{ label: 'Joined', cell: (r) => when(r.created_at) },
				{ label: 'Access', cell: (r) => <BlockButton id={r.id} blocked={r.blocked} onAuthError={onAuthError} /> },
			]}
		/>
	);
}

export function StoresTable({ onAuthError }: Props) {
	// Owners who have stores, for the owner filter.
	const owners = useApi<{ owners: { id: number; name: string; store_count: number }[] }>('/admin/store-owners', {}, onAuthError).data?.owners ?? [];
	return (
		<DataTable
			title="Stores"
			path="/admin/stores"
			filterParam="type"
			filterOptions={['food', 'laundry']}
			searchPlaceholder="Search name or address"
			onAuthError={onAuthError}
			extraFilters={[
				{
					param: 'owner',
					label: 'Owner',
					options: [...owners.map((o) => ({ value: String(o.id), label: `${o.name} (${o.store_count})` })), { value: 'none', label: 'No owner' }],
				},
			]}
			dateRange
			summary={(d) => (
				<>
					Total service fee <b>{peso(d.total_service_fee)}</b>
					<span className="cp-summary-sep" />
					Total app fee <b>{peso(d.total_app_fee)}</b>
				</>
			)}
			columns={[
				{ label: '#', cell: (r) => <StoreDetailsCell id={r.id} onAuthError={onAuthError} /> },
				{
					label: 'Store',
					cell: (r) => (
						<StoreDetailsCell id={r.id} onAuthError={onAuthError}>
							<span className="cp-store">
								{r.store_logo ? <img src={r.store_logo} alt="" /> : <span className="cp-logo-blank" />}
								{person(r.name, r.address)}
							</span>
						</StoreDetailsCell>
					),
				},
				{ label: 'Type', cell: (r) => badge(r.type) },
				{ label: 'Service Fee', cell: (r) => peso(r.service_fee), className: 'num' },
				{ label: 'Sales', cell: (r) => peso(r.sales), className: 'num' },
				{ label: 'App Fee', cell: (r) => <AppFee row={r as Parameters<typeof AppFee>[0]['row']} />, className: 'num' },
				{ label: 'Owner', cell: (r) => <StoreOwnerCell store={r as Parameters<typeof StoreOwnerCell>[0]['store']} onAuthError={onAuthError} /> },
				{ label: 'Group', cell: (r) => <GroupCell store={r} onAuthError={onAuthError} /> },
				{ label: 'Orders', cell: (r) => r.order_count, className: 'num' },
				{ label: 'Drop offs', cell: (r) => r.dropoff_count, className: 'num' },
			]}
		/>
	);
}
