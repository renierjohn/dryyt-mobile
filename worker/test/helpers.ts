import { SELF } from 'cloudflare:test';

type Options = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; token?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, opts: Options = {}) {
  const res = await SELF.fetch(`https://api.test${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

let counter = 0;

export async function registerUser(role: 'customer' | 'driver' | 'owner') {
  counter += 1;
  const tag = `${counter}-${crypto.randomUUID().slice(0, 8)}`;
  const { body } = await api<{ token: string; user: { id: number; role: string; name: string; phone: string } }>('/auth/register', {
    body: {
      email: `${role}${tag}@test.com`,
      password: 'password123',
      name: `${role} ${counter}`,
      phone: `0917000${String(counter).padStart(4, '0')}`,
      role,
    },
  });
  return body;
}
