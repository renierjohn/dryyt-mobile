import { ArrowUpRight, Globe, LogIn, MonitorSmartphone, Route } from 'lucide-react';

export const TRACKER_URL = 'https://app.dryyt.com';

const points = [
	{ icon: Globe, text: 'Works in any browser, no install needed' },
	{ icon: Route, text: 'Follow your laundry every step of the way' },
	{ icon: LogIn, text: 'Sign in and open My Track to see your status' },
];

export default function Tracker() {
	return (
		<section id="tracker" className="section">
			<div className="container">
				<div className="tracker">
					<div className="tracker-copy">
						<p className="eyebrow tracker-eyebrow">Also from Dryyt</p>
						<h2>Dryyt Tracker on the web</h2>
						<p className="tracker-lead">
							Not on your phone? Use Dryyt Tracker at <b>app.dryyt.com</b> to check your laundry from your computer or any browser.
						</p>
						<ul className="tracker-points">
							{points.map((p) => (
								<li key={p.text}>
									<p.icon size={20} />
									{p.text}
								</li>
							))}
						</ul>
						<a href={TRACKER_URL} target="_blank" rel="noopener" className="btn">
							Track now <ArrowUpRight size={18} />
						</a>
					</div>
					<a href={TRACKER_URL} target="_blank" rel="noopener" className="tracker-window" aria-label="Open Dryyt Tracker">
						<div className="tracker-bar">
							<span />
							<span />
							<span />
							<div className="tracker-url">app.dryyt.com</div>
						</div>
						<div className="tracker-screen">
							<MonitorSmartphone size={72} strokeWidth={1.5} />
							<strong>Dryyt Tracker</strong>
							<small>Track now →</small>
						</div>
					</a>
				</div>
			</div>
		</section>
	);
}
