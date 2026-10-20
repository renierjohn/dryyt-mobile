import { PackageCheck, Shirt, UtensilsCrossed } from 'lucide-react';

const services = [
	{
		icon: UtensilsCrossed,
		title: 'Food Pickup',
		text: 'Browse menus from local restaurants and get your order picked up hot and fast.',
	},
	{
		icon: Shirt,
		title: 'Laundry Pickup',
		text: 'Have your washed clothes collected from your laundry shop and delivered home.',
	},
	{
		icon: PackageCheck,
		title: 'Laundry Drop off',
		text: 'Book a driver to take your laundry to the shop — track every step in real time.',
	},
];

export default function Services() {
	return (
		<section id="services" className="section">
			<div className="container">
				<h2>One app, everything delivered</h2>
				<div className="grid-3">
					{services.map((s) => (
						<article key={s.title} className="card service">
							<div className="service-icon">
								<s.icon size={30} />
							</div>
							<h3>{s.title}</h3>
							<p>{s.text}</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
