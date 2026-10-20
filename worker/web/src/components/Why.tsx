import { History, MapPinned, ReceiptText, Store } from 'lucide-react';

const reasons = [
	{ icon: MapPinned, title: 'Live tracking', text: 'Follow your driver on the map from pickup to your doorstep.' },
	{ icon: ReceiptText, title: 'Clear pricing', text: 'See the order amount and delivery fee before you book.' },
	{ icon: Store, title: 'Local stores', text: 'Support restaurants and laundry shops in your neighbourhood.' },
	{ icon: History, title: 'Order history', text: 'Every order and drop off saved, grouped by date.' },
];

export default function Why() {
	return (
		<section className="section section-tint">
			<div className="container">
				<h2>Why order with Dryyt?</h2>
				<div className="grid-4">
					{reasons.map((r) => (
						<div key={r.title} className="why">
							<span className="why-icon">
								<r.icon size={24} />
							</span>
							<h3>{r.title}</h3>
							<p>{r.text}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
