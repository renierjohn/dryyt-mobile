import { useEffect, useState } from 'react';
import { api, type Page } from './api';

/** Fetches `path` with the given query params; refetches whenever they change. */
export function useApi<T>(path: string, params: Record<string, string | number>, onError: (e: unknown) => void) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);
	const query = new URLSearchParams(
		Object.entries(params)
			.filter(([, v]) => v !== '')
			.map(([k, v]) => [k, String(v)]),
	).toString();

	useEffect(() => {
		let live = true;
		setLoading(true);
		api<T>(query ? `${path}?${query}` : path)
			.then((d) => live && (setData(d), setError('')))
			.catch((e) => {
				if (!live) return;
				setError(e instanceof Error ? e.message : 'Request failed');
				onError(e);
			})
			.finally(() => live && setLoading(false));
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [path, query]);

	return { data, error, loading };
}

export type { Page };
