import { Bike, Briefcase, Calculator, LayoutDashboard, Shirt, ShoppingBag, Store, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken } from './api';
import Login from './Login';
import Overview from './Overview';
import Rates from './Rates';
import { DriversTable, DropoffsTable, OrdersTable, OwnersTable, StoresTable, UsersTable } from './tables';

const tabs = [
	{ key: 'overview', label: 'Overview', icon: LayoutDashboard, view: Overview },
	{ key: 'orders', label: 'Pickup orders', icon: ShoppingBag, view: OrdersTable },
	{ key: 'dropoffs', label: 'Drop offs', icon: Shirt, view: DropoffsTable },
	{ key: 'users', label: 'Users', icon: Users, view: UsersTable },
	{ key: 'drivers', label: 'Drivers', icon: Bike, view: DriversTable },
	{ key: 'rates', label: 'Rates', icon: Calculator, view: Rates },
	{ key: 'stores', label: 'Stores', icon: Store, view: StoresTable },
	{ key: 'owners', label: 'Owners', icon: Briefcase, view: OwnersTable },
] as const;
type TabKey = (typeof tabs)[number]['key'];

type Admin = { id: number; email: string; name: string };

export default function Cpanel() {
	const [admin, setAdmin] = useState<Admin | null>(null);
	const [checking, setChecking] = useState(!!getToken());
	const [tab, setTab] = useState<TabKey>(() => (location.hash.slice(1) as TabKey) || 'overview');

	useEffect(() => {
		if (!getToken()) return;
		api<{ user: Admin }>('/admin/me')
			.then((r) => setAdmin(r.user))
			.catch(() => setToken(null))
			.finally(() => setChecking(false));
	}, []);

	useEffect(() => {
		history.replaceState(null, '', `#${tab}`);
	}, [tab]);

	// Links like /cpanel#users switch tabs without a reload.
	useEffect(() => {
		const onHash = () => setTab((location.hash.slice(1) as TabKey) || 'overview');
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	}, []);

	const signOut = () => {
		setToken(null);
		setAdmin(null);
	};

	if (checking) return <div className="cp-center">Loading…</div>;
	if (!admin) return <Login onSignedIn={setAdmin} />;

	const View = (tabs.find((t) => t.key === tab) ?? tabs[0]).view;
	return (
		<div className="cp">
			<aside className="cp-side">
				<a href="/" className="cp-brand">
					<img src="/icon.png" alt="" width={28} height={28} />
					Dryyt <span>cpanel</span>
				</a>
				<nav>
					{tabs.map((t) => (
						<button key={t.key} className={t.key === tab ? 'active' : ''} onClick={() => setTab(t.key)}>
							<t.icon size={18} strokeWidth={2} aria-hidden />
							{t.label}
						</button>
					))}
				</nav>
				<div className="cp-me">
					<div>{admin.name}</div>
					<small>{admin.email}</small>
					<button onClick={signOut}>Sign out</button>
				</div>
			</aside>
			<main className="cp-main">
				<View onAuthError={(e: unknown) => e instanceof ApiError && e.status === 401 && signOut()} />
			</main>
		</div>
	);
}
