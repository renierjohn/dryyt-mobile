import { env, SELF } from 'cloudflare:test';

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

/** POST /orders with a payment reference; a food order is then released to drivers as if the owner confirmed it and the customer placed it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function placeOrder<T = any>(opts: Omit<Options, 'method'> & { body: Record<string, unknown> }) {
  const res = await api<T>('/orders', { ...opts, body: { payment_ref: 'GCASH-REF-1', ...opts.body } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const order = (res.body as any)?.order;
  if (res.status === 201 && order.status === 'awaiting_payment') {
    await env.DB.prepare("UPDATE transactions_pickup SET status = 'pending' WHERE id = ?").bind(order.id).run();
    order.status = 'pending';
  }
  return res;
}
