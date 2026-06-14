// In-memory store of just-built games, keyed by an unguessable token. The Studio
// builds a game server-side, stashes the HTML here, and hands back a capability
// URL on the untrusted games origin (/preview/:token) so the phone can play it in
// a sandboxed iframe. Entries expire; this is a preview buffer, not storage.

import { randomUUID } from 'crypto';

type Entry = { html: string; at: number };
const store = new Map<string, Entry>();
const TTL_MS = 1000 * 60 * 60; // 1 hour
const MAX = 200;

function gc(): void {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
}

export function putPreview(html: string): string {
  if (store.size > MAX) gc();
  const token = randomUUID().replace(/-/g, '');
  store.set(token, { html, at: Date.now() });
  return token;
}

export function getPreview(token: string): string | null {
  const e = store.get(token);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    store.delete(token);
    return null;
  }
  return e.html;
}
