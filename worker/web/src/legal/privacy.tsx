import { CONTACT_EMAIL, renderLegal, type Section } from './LegalPage';

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const sections: Section[] = [
	{
		id: 'collect',
		title: 'Information we collect',
		body: (
			<>
				<p>We only collect what we need to run deliveries:</p>
				<ul>
					<li>
						<b>Account details</b>: your name, email address, phone number, password (stored only as a secure hash) and whether you
						are a customer, driver or store owner.
					</li>
					<li>
						<b>Location</b>: your delivery pin and address when you book. For drivers, your live location while you are online or
						on a job, so customers can track the delivery and we can offer nearby jobs.
					</li>
					<li>
						<b>Orders and drop offs</b>: stores, items, notes, amounts, fees, distance, status and timestamps.
					</li>
					<li>
						<b>Photos you upload</b>: payment proofs and reference numbers (customers), drop off proof photos (drivers), store
						logos, payment QR codes and menu photos (store owners).
					</li>
					<li>
						<b>Driver verification</b>: a face photo, an ID or license photo and verification notes. The face photo is taken with a
						live face check on your phone, which only checks that a face is in frame; we do not create face templates or use facial
						recognition.
					</li>
					<li>
						<b>Device data</b>: a push notification token so we can send order updates to your phone.
					</li>
				</ul>
			</>
		),
	},
	{
		id: 'use',
		title: 'How we use it',
		body: (
			<ul>
				<li>To create your account and sign you in.</li>
				<li>To match orders and drop offs with nearby drivers, calculate distance and fees, and show live tracking.</li>
				<li>To let stores confirm payments and orders, and to record what drivers and stores earn.</li>
				<li>To verify drivers before they take jobs.</li>
				<li>To send notifications about your orders.</li>
				<li>To keep the service safe, resolve disputes and meet legal obligations.</li>
			</ul>
		),
	},
	{
		id: 'share',
		title: 'Who we share it with',
		body: (
			<>
				<p>We do not sell your personal information. We share it only as needed to complete a delivery:</p>
				<ul>
					<li>
						<b>Between users of an order</b>: the driver sees the customer's name, phone, address and pin; the customer sees the
						driver's name and live location; the store sees the order, the customer's name and the payment proof.
					</li>
					<li>
						<b>Service providers</b>: cloud hosting and storage, route and distance services (which receive pickup and delivery
						coordinates, not your name), and push notification services.
					</li>
					<li>
						<b>Authorities</b>, when required by law or to protect the safety of our users.
					</li>
				</ul>
				<p>Payments are made directly to the store through its own payment QR code; we do not receive or store your card or e-wallet details.</p>
			</>
		),
	},
	{
		id: 'retention',
		title: 'How long we keep it',
		body: (
			<p>
				We keep your account details while your account is active. Order, drop off and earnings records are kept for as long as
				needed for accounting, dispute and legal purposes. Live driver location is overwritten as it updates. When you ask us to
				delete your account, we delete or anonymise your personal information unless we must keep it by law.
			</p>
		),
	},
	{
		id: 'security',
		title: 'Security',
		body: (
			<p>
				Data is sent over encrypted connections, passwords are hashed, and uploaded photos are stored privately and shown only to
				the people involved in that order. No system is completely secure, so please keep your password private.
			</p>
		),
	},
	{
		id: 'rights',
		title: 'Your rights',
		body: (
			<>
				<p>
					Under the Data Privacy Act of 2012 (Republic Act No. 10173), you have the right to be informed, to access, correct and
					erase your personal data, to object to its processing, to data portability, and to file a complaint with the National
					Privacy Commission.
				</p>
				<p>To use any of these rights, email us at {mail}.</p>
			</>
		),
	},
	{
		id: 'permissions',
		title: 'App permissions',
		body: (
			<ul>
				<li>
					<b>Location</b>: to pin your address and, for drivers, to share location during jobs.
				</li>
				<li>
					<b>Camera and photos</b>: to upload payment proofs, drop off proofs, verification photos and store images.
				</li>
				<li>
					<b>Notifications</b>: for order updates.
				</li>
			</ul>
		),
	},
	{
		id: 'children',
		title: 'Children',
		body: <p>Dryyt is not meant for anyone under 18, and we do not knowingly collect their information.</p>,
	},
	{
		id: 'changes',
		title: 'Changes to this policy',
		body: <p>We may update this policy. We will change the date above and tell you in the app if the changes are significant.</p>,
	},
	{
		id: 'contact',
		title: 'Contact us',
		body: <p>Questions about your privacy? Email us at {mail}.</p>,
	},
];

renderLegal({
	title: 'Privacy Policy',
	intro: 'This policy explains what personal information Dryyt collects when you use our app and website, how we use it, and the choices you have.',
	sections,
});
