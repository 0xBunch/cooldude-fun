// Studio gate. A shared STUDIO_CODE unlocks the game-maker and sets a signed,
// HttpOnly, SameSite=Strict cookie. If STUDIO_CODE is unset the Studio is
// disabled and nothing can unlock it.

import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

const COOKIE = 'studio_gate';
const VALUE = 'ok';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function studioEnabled(): boolean {
  return config.studioCode.length > 0;
}

export function studioCodeMatches(input: unknown): boolean {
  if (!config.studioCode) return false; // disabled => nothing matches
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(config.studioCode);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function setStudioGate(c: Context): Promise<void> {
  await setSignedCookie(c, COOKIE, VALUE, config.cookieSecret, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'Strict',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function isStudioGated(c: Context): Promise<boolean> {
  const v = await getSignedCookie(c, config.cookieSecret, COOKIE);
  return v === VALUE;
}
