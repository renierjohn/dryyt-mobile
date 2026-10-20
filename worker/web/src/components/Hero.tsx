import { Bike, MapPin, Shirt, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';

// Address search is hidden until it does something useful; set to true to show it again.
const SHOW_SEARCH = false;

export default function Hero() {
	const [address, setAddress] = useState('');

	return (
		<section className="hero">
			<div className="container hero-inner">
				<div className="hero-copy">
					<p className="eyebrow">Food · Laundry · Drop off</p>
					<h1>Your favourite food and fresh laundry, delivered.</h1>
					<p className="lead">
						Order from nearby stores or book a laundry drop off. A Dryyt driver picks it up and brings it to your door.
					</p>
					{SHOW_SEARCH && (
					<form
						className="search"
						onSubmit={(e) => {
							e.preventDefault();
							document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
						}}
					>
						<span className="search-pin" aria-hidden>
							<MapPin size={20} />
						</span>
						<input
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							placeholder="Enter your delivery address"
							aria-label="Delivery address"
						/>
						<button className="btn" type="submit">
							Search
						</button>
					</form>
					)}
				</div>
				<div className="hero-art" aria-hidden>
					<div className="bubble bubble-food">
						<UtensilsCrossed />
					</div>
					<div className="bubble bubble-laundry">
						<Shirt />
					</div>
					<div className="bubble bubble-ride">
						<Bike />
					</div>
				</div>
			</div>
		</section>
	);
}
