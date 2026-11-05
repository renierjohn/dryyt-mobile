import { CONTACT_EMAIL, renderLegal, type Section } from './LegalPage';

// Google Play's account deletion URL: how to ask for deletion, what is deleted, what is kept and for how long.
const SUBJECT = 'Delete my Dryyt account';
const BODY = 'Please delete my Dryyt account and personal data.\n\nName:\nEmail or phone used to sign in:\nAccount type (customer, driver or store owner):';
const requestHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(BODY)}`;

const sections: Section[] = [
	{
		id: 'request',
		title: 'How to request deletion',
		body: (
			<>
				<p>
					Email us from the address on your Dryyt account, or include the email or phone number you sign in with, and tell us your
					account type. The button below opens a ready-made email.
				</p>
				<p>
					<a href={requestHref} className="btn">
						Request account deletion
					</a>
				</p>
				<p>
					We may ask you to confirm the request from your account's email or phone, so nobody else can delete your account. We
					reply within 7 days and finish the deletion within 30 days.
				</p>
			</>
		),
	},
	{
		id: 'deleted',
		title: 'What we delete',
		body: (
			<ul>
				<li>Your account: name, email address, phone number, password and sign-in links.</li>
				<li>Saved addresses and delivery pins, and your push notification token.</li>
				<li>Driver verification photos (face and ID or license) and verification notes.</li>
				<li>Store logos, payment QR codes and menu photos, for store owners.</li>
				<li>Your chat messages and live location history.</li>
			</ul>
		),
	},
	{
		id: 'kept',
		title: 'What we keep',
		body: (
			<p>
				Records of completed orders, drop offs, payments and earnings are kept for accounting, dispute and legal purposes, as
				required by Philippine law, with your name and contact details removed. Payment proof photos attached to those orders are
				kept with them. Everything else is deleted.
			</p>
		),
	},
	{
		id: 'opt-out',
		title: 'Opting out without deleting',
		body: (
			<ul>
				<li>Notifications: turn them off for Dryyt in your phone's settings.</li>
				<li>Location: turn off location for Dryyt in your phone's settings; you can still type your address when booking.</li>
				<li>Anything else, such as stopping a specific use of your data: email us at the address below.</li>
			</ul>
		),
	},
	{
		id: 'contact',
		title: 'Contact us',
		body: (
			<>
				<p>Questions about your account or your data? We're happy to help.</p>
				<p>
					<a href={`mailto:${CONTACT_EMAIL}`} className="btn">
						Contact {CONTACT_EMAIL}
					</a>
				</p>
			</>
		),
	},
];

renderLegal({
	title: 'Delete Your Account',
	intro: 'You can ask Dryyt to delete your account and the personal data linked to it at any time. This page explains how, and what happens to your data.',
	sections,
});
