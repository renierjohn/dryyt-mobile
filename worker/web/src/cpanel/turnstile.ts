// Cloudflare Turnstile for the cpanel sign-in. The sitekey is public and baked in at build time from
// VITE_TURNSTILE_SITEKEY in web/.env; the widget lists dryyt.com, www.dryyt.com and localhost.
export const TURNSTILE_SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined;

type Turnstile = {
	render: (el: HTMLElement, opts: Record<string, unknown>) => string;
	reset: (id: string) => void;
	remove: (id: string) => void;
};
declare global {
	interface Window {
		turnstile?: Turnstile;
	}
}

let loading: Promise<Turnstile> | undefined;

export function loadTurnstile(): Promise<Turnstile> {
	loading ??= new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		s.async = true;
		s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')));
		s.onerror = () => {
			loading = undefined;
			reject(new Error('Turnstile failed to load'));
		};
		document.head.appendChild(s);
	});
	return loading;
}
