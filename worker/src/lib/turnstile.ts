import type { Context } from 'hono';

import type { AppEnv } from '../types';
import { fail } from './http';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type SiteverifyResult = { success: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };

/**
 * Checks a Turnstile token with Cloudflare siteverify, or fails with 403. Tokens are single-use.
 * Needs TURNSTILE_SECRET (wrangler secret / .dev.vars) and TURNSTILE_HOSTNAMES, the comma-separated frontend
 * hostnames this deployment accepts (never localhost in production).
 */
export async function verifyTurnstile(c: Context<AppEnv>, token: unknown, expectedAction: string) {
  const expectedHostnames = new Set(
    (c.env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  );
  if (!c.env.TURNSTILE_SECRET || expectedHostnames.size === 0) {
    console.error('[turnstile] TURNSTILE_SECRET or TURNSTILE_HOSTNAMES is not set');
    fail(403, 'Verification failed, please try again');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) fail(403, 'Verification failed, please try again');

  let result: SiteverifyResult;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret: c.env.TURNSTILE_SECRET,
        response: token,
        remoteip: c.req.header('cf-connecting-ip') ?? '',
      }),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = await res.json<SiteverifyResult>();
  } catch (err) {
    console.error('[turnstile] siteverify failed', err);
    fail(403, 'Verification failed, please try again');
  }
  if (!result.success || result.action !== expectedAction || !expectedHostnames.has(result.hostname ?? '')) {
    console.warn('[turnstile] rejected', { action: result.action, hostname: result.hostname, errors: result['error-codes'] });
    fail(403, 'Verification failed, please try again');
  }
}
