import { Bike, ShoppingBag, SquareCheckBig } from 'lucide-react';

const steps = [
	{ icon: ShoppingBag, title: 'Choose', text: 'Pick a store and your items, or book a laundry drop off.' },
	{ icon: SquareCheckBig, title: 'Confirm', text: 'Review your order and total, then place it in a tap.' },
	{ icon: Bike, title: 'Relax', text: 'A nearby driver accepts and delivers — track them live.' },
];

export default function HowItWorks() {
	return (
		<section id="how" className="section">
			<div className="container">
				<h2>How it works</h2>
				<ol className="steps">
					{steps.map((s, i) => (
						<li key={s.title} className="step">
							<div className="step-head">
								<span className="step-dot">{i + 1}</span>
								<s.icon size={28} />
							</div>
							<h3>{s.title}</h3>
							<p>{s.text}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
