// Soft gate. A shared "arcade code" sets a signed, HttpOnly cookie that the
// server checks before accepting score submissions. The cookie is unreadable by
// page JS (HttpOnly) and not sent on cross-site subrequests (SameSite=Lax), so a
// sandboxed game (opaque origin) cannot reuse it to post scores.

import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { timingSafeEqual } from 'crypto';
import { config } from './config';

const COOKIE = 'arcade_gate';
const VALUE = 'ok';
const MAX_AGE = 60 * 60 * 24 * 180; // ~180 days

export function codeMatches(input: unknown): boolean {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(config.arcadeCode);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function setGate(c: Context): Promise<void> {
  await setSignedCookie(c, COOKIE, VALUE, config.cookieSecret, {
    httpOnly: true,
    secure: config.isProd, // http on localhost in dev, https in prod
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function isGated(c: Context): Promise<boolean> {
  const v = await getSignedCookie(c, config.cookieSecret, COOKIE);
  return v === VALUE;
}
