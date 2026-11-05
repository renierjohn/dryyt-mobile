import { Mail } from 'lucide-react';
import { CONTACT_EMAIL } from '../contact';

export default function Footer() {
	return (
		<footer id="download" className="footer">
			<div className="container">
				<div className="cta">
					<div>
						<h2>Get Dryyt on your phone</h2>
						<p>Order food, laundry and drop offs in minutes.</p>
						<a href={`mailto:${CONTACT_EMAIL}`} className="btn btn-small footer-contact">
							<Mail size={16} aria-hidden /> Contact support
						</a>
					</div>
					<div className="stores">
						<a href="#" className="store-btn">
							<img src="/apple.webp" alt="" className="store-icon" /> App Store
						</a>
						<a href="#" className="store-btn">
							<img src="/googleplay.jpg" alt="" className="store-icon store-icon-jpg" /> Google Play
						</a>
					</div>
				</div>
				<div className="footer-bottom">
					<span className="brand brand-light">
						<img src="/icon.png" alt="" width={24} height={24} />
						Dryyt
					</span>
					<nav className="footer-links">
						<a href="/privacy">Privacy Policy</a>
						<a href="/terms">Terms &amp; Conditions</a>
						<a href="/delete-account">Delete account</a>
					</nav>
					<span>© {new Date().getFullYear()} Dryyt. All rights reserved.</span>
				</div>
			</div>
		</footer>
	);
}
