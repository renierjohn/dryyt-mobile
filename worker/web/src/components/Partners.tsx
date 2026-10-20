import { Bike, Store } from 'lucide-react';

export default function Partners() {
	return (
		<section id="partners" className="section">
			<div className="container grid-2">
				<div className="card partner partner-brand">
					<span className="partner-icon">
						<Bike size={30} />
					</span>
					<h3>Drive with Dryyt</h3>
					<p>Earn on your own schedule. See what you earn on every job before you accept it.</p>
					<a href="#download" className="btn btn-light">
						Become a driver
					</a>
				</div>
				<div className="card partner partner-dark">
					<span className="partner-icon">
						<Store size={30} />
					</span>
					<h3>Grow your store</h3>
					<p>List your restaurant or laundry shop, manage your menu and reach more customers.</p>
					<a href="#download" className="btn btn-light">
						Become a partner
					</a>
				</div>
			</div>
		</section>
	);
}
