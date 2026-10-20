const TOKEN_KEY = 'dryyt-cpanel-token';

export function getToken() {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string | null) {
	try {
		if (token) localStorage.setItem(TOKEN_KEY, token);
		else localStorage.removeItem(TOKEN_KEY);
	} catch {
		// Private mode: the session lasts until reload.
	}
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

/** Same-origin worker API; errors come back as { error } JSON (worker/src/index.ts onError). */
export async function api<T>(path: string, init: { body?: unknown; token?: string | null } = {}): Promise<T> {
	const token = init.token === undefined ? getToken() : init.token;
	const res = await fetch(path, {
		method: init.body === undefined ? 'GET' : 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	const text = await res.text();
	if (!res.ok) {
		let message = text;
		try {
			message = JSON.parse(text).error ?? text;
		} catch {
			// plain text
		}
		throw new ApiError(res.status, message || res.statusText);
	}
	return JSON.parse(text) as T;
}

export type Page<T> = { rows: T[]; total: number; page: number; page_size: number };

export const peso = (centavos: number | null | undefined) =>
	centavos == null ? '—' : `₱${(centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** D1 stores UTC "YYYY-MM-DD HH:MM:SS". */
export const when = (s: string | null | undefined) =>
	s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Raw bytes (an image) from the API, or an upload of them; for endpoints that don't speak JSON. */
export async function apiBinary(path: string, body?: Blob): Promise<Blob> {
	const token = getToken();
	const res = await fetch(path, {
		method: body ? 'POST' : 'GET',
		headers: token ? { authorization: `Bearer ${token}`, ...(body ? { 'content-type': body.type } : {}) } : {},
		body,
	});
	if (!res.ok) {
		let message = res.statusText;
		try {
			message = (await res.json()).error ?? message;
		} catch {
			// not JSON
		}
		throw new ApiError(res.status, message);
	}
	return res.blob();
}
