import { useEffect, useRef, useState } from 'react';
import { api, setToken } from './api';
import { loadTurnstile, TURNSTILE_SITEKEY } from './turnstile';

type Admin = { id: number; email: string; name: string };

export default function Login({ onSignedIn }: { onSignedIn: (a: Admin) => void }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [captcha, setCaptcha] = useState('');
	const box = useRef<HTMLDivElement>(null);
	const widgetId = useRef<string | null>(null);

	useEffect(() => {
		if (!TURNSTILE_SITEKEY) {
			setError('Sign in is not configured (missing Turnstile sitekey).');
			return;
		}
		let live = true;
		loadTurnstile()
			.then((t) => {
				if (!live || !box.current) return;
				widgetId.current = t.render(box.current, {
					sitekey: TURNSTILE_SITEKEY,
					action: 'cpanel_login',
					callback: (token: string) => setCaptcha(token),
					'expired-callback': () => setCaptcha(''),
					'error-callback': () => setCaptcha(''),
				});
			})
			.catch((e) => live && setError(e.message));
		return () => {
			live = false;
			if (widgetId.current) window.turnstile?.remove(widgetId.current);
			widgetId.current = null;
		};
	}, []);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!captcha) {
			setError('Please complete the verification.');
			return;
		}
		setBusy(true);
		setError('');
		try {
			const { token, user } = await api<{ token: string; user: Admin }>('/admin/login', {
				body: { email, password, turnstile_token: captcha },
				token: null,
			});
			setToken(token);
			onSignedIn(user);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Sign in failed');
			// Tokens are single-use: get a fresh one before the next try.
			setCaptcha('');
			if (widgetId.current) window.turnstile?.reset(widgetId.current);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="cp-center">
			<form className="cp-login" onSubmit={submit}>
				<img src="/icon.png" alt="" width={48} height={48} />
				<h1>Dryyt cpanel</h1>
				<label>
					Email
					<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
				</label>
				<label>
					Password
					<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
				</label>
				<div ref={box} className="cp-turnstile" />
				{error && <p className="cp-error">{error}</p>}
				<button className="cp-btn" disabled={busy || !captcha}>
					{busy ? 'Signing in…' : 'Sign in'}
				</button>
			</form>
		</div>
	);
}
