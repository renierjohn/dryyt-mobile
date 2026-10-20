import { CONTACT_EMAIL, renderLegal, type Section } from './LegalPage';

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const sections: Section[] = [
	{
		id: 'about',
		title: 'About Dryyt',
		body: (
			<p>
				Dryyt is a platform that connects customers, independent drivers and partner stores for food and laundry pickup and laundry
				drop off. Stores prepare and sell their own food and laundry services; drivers carry out the deliveries. Dryyt provides the
				app that brings them together.
			</p>
		),
	},
	{
		id: 'accounts',
		title: 'Your account',
		body: (
			<ul>
				<li>You must be at least 18 years old and give accurate details when you sign up.</li>
				<li>You are responsible for keeping your password safe and for everything done with your account.</li>
				<li>One person per account. Do not share or sell your account.</li>
			</ul>
		),
	},
	{
		id: 'orders',
		title: 'Orders and drop offs',
		body: (
			<ul>
				<li>Prices, delivery fees and service fees are shown before you confirm. The total you see is what you pay.</li>
				<li>
					Pickup orders are paid upfront to the store through its payment QR code. The store confirms your payment before the order
					is sent to drivers.
				</li>
				<li>
					For drop offs, the laundry fee is set by the shop after it weighs your laundry, and is shown to you in the app before you
					pay.
				</li>
				<li>Give a correct address and pin, and be available to receive your order.</li>
				<li>Do not order or send prohibited, illegal or dangerous items.</li>
			</ul>
		),
	},
	{
		id: 'cancellations',
		title: 'Cancellations and refunds',
		body: (
			<>
				<p>
					You can cancel an order before a driver picks it up. Once picked up, it can no longer be cancelled. A request that finds
					no driver in time expires automatically.
				</p>
				<p>
					Because payment goes directly to the store, refunds for cancelled or incorrect orders are handled by the store. Contact us
					at {mail} if you need help with a store.
				</p>
			</>
		),
	},
	{
		id: 'drivers',
		title: 'Drivers',
		body: (
			<ul>
				<li>Drivers must complete verification and hold a valid license and any permits their vehicle requires.</li>
				<li>Drivers are independent and choose when to go online and which jobs to accept.</li>
				<li>Your earnings for each job are shown before you accept it.</li>
				<li>Handle orders with care, follow traffic laws and deliver to the pinned location.</li>
			</ul>
		),
	},
	{
		id: 'stores',
		title: 'Stores',
		body: (
			<ul>
				<li>Stores are responsible for their menus, prices, food safety, laundry quality and the accuracy of their listings.</li>
				<li>Stores must confirm genuine payments promptly and only use payment QR codes they own.</li>
				<li>Stores may block a driver from their jobs for good reason.</li>
			</ul>
		),
	},
	{
		id: 'conduct',
		title: 'Acceptable use',
		body: (
			<>
				<p>You agree not to:</p>
				<ul>
					<li>harass, threaten or harm other users;</li>
					<li>upload fake payment proofs or misleading photos;</li>
					<li>misuse other users' contact details or location;</li>
					<li>interfere with, scrape or reverse-engineer the service.</li>
				</ul>
				<p>We may suspend or close accounts that break these terms.</p>
			</>
		),
	},
	{
		id: 'liability',
		title: 'Liability',
		body: (
			<p>
				We work to keep Dryyt available and accurate, but the service is provided "as is". To the extent allowed by law, Dryyt is
				not liable for the quality of goods and services sold by stores, for delays caused by traffic, weather or events outside
				our control, or for indirect losses. Nothing in these terms limits rights you have under Philippine consumer law.
			</p>
		),
	},
	{
		id: 'privacy',
		title: 'Privacy',
		body: (
			<p>
				Our <a href="/privacy">Privacy Policy</a> explains how we handle your personal information.
			</p>
		),
	},
	{
		id: 'changes',
		title: 'Changes and governing law',
		body: (
			<p>
				We may update these terms and will tell you in the app if the changes are significant. Continuing to use Dryyt means you
				accept the updated terms. These terms are governed by the laws of the Republic of the Philippines.
			</p>
		),
	},
	{
		id: 'contact',
		title: 'Contact us',
		body: <p>Questions about these terms? Email us at {mail}.</p>,
	},
];

renderLegal({
	title: 'Terms & Conditions',
	intro: 'These terms apply when you use the Dryyt app or website as a customer, driver or store owner. By creating an account or using Dryyt, you agree to them.',
	sections,
});
