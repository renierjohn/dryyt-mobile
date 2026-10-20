const faqs = [
	{
		q: 'What can I order on Dryyt?',
		a: 'Food from partner restaurants, laundry pickup from partner shops, and laundry drop off to a shop of your choice.',
	},
	{
		q: 'How much is delivery?',
		a: 'The delivery fee is shown on the order screen before you confirm, so there are no surprises.',
	},
	{
		q: 'Can I track my driver?',
		a: 'Yes. Once a driver accepts, you can follow them live on the map until delivery.',
	},
	{
		q: 'Can I cancel an order?',
		a: 'You can cancel before a driver picks it up. Cancelled orders stay in your history for reference.',
	},
];

export default function Faq() {
	return (
		<section id="faq" className="section section-tint">
			<div className="container faq">
				<h2>Frequently asked questions</h2>
				{faqs.map((f) => (
					<details key={f.q} className="faq-item">
						<summary>{f.q}</summary>
						<p>{f.a}</p>
					</details>
				))}
			</div>
		</section>
	);
}
