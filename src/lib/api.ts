import { File } from 'expo-file-system';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8788';

let authToken: string | null = null;
let onUnauthorized = (_message: string) => {};

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called with the server's reason (e.g. "This account is blocked…") when a signed-in request gets a 401. */
export function setUnauthorizedHandler(handler: (message: string) => void) {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const apiUrl = (path: string) => `${API_URL}${path}`;
export const wsUrl = (path: string) => `${API_URL.replace(/^http/, 'ws')}${path}`;
export const authHeaders = (): Record<string, string> => (authToken ? { authorization: `Bearer ${authToken}` } : {});

type Options = { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown };

export function api<T>(path: string, { method, body }: Options = {}): Promise<T> {
  return request<T>(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Sends a local file (e.g. a camera photo) as the raw request body. Read straight from the file system:
 * `fetch(uri).blob()` would round-trip the bytes through React Native's base64 Blob store.
 */
export async function uploadImage<T>(path: string, uri: string, contentType: string): Promise<T> {
  const bytes = await new File(uri).bytes();
  return request<T>(path, { method: 'POST', headers: { 'content-type': contentType }, body: bytes });
}

async function request<T>(path: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array<ArrayBuffer> }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers: { ...init.headers, ...authHeaders() } });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error ?? `Request failed (${res.status})`;
    if (res.status === 401 && authToken) onUnauthorized(message);
    throw new ApiError(res.status, message);
  }
  return data as T;
}
