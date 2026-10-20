const links = [
	{ href: '/#services', label: 'Services' },
	{ href: '/#how', label: 'How it works' },
	{ href: '/#tracker', label: 'Tracker' },
	{ href: '/#partners', label: 'Partners' },
	{ href: '/#faq', label: 'FAQ' },
];

export default function Header() {
	return (
		<header className="header">
			<div className="container header-inner">
				<a href="/" className="brand">
					<img src="/icon.png" alt="" width={32} height={32} />
					<span>Dryyt</span>
				</a>
				<nav className="nav">
					{links.map((l) => (
						<a key={l.href} href={l.href}>
							{l.label}
						</a>
					))}
				</nav>
				<a href="/#download" className="btn btn-small">
					Get the app
				</a>
			</div>
		</header>
	);
}
