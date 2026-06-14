// Untrusted game host (games.cooldude.fun in prod). Serves the raw game HTML
// out of Drive with the Arcade SDK injected, plus the SDK file itself. Games are
// embedded only by the trusted shell via a sandboxed iframe.

import { Hono } from 'hono';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { getGameHtml } from '../cache';
import { getPreview } from '../studio/preview-store';

export const games = new Hono();

// Read once at startup — it ships with the deploy and never changes at runtime.
const SDK_JS = readFileSync(join(__dirname, '..', '..', 'public-games', 'arcade-sdk.js'), 'utf8');

games.get('/arcade-sdk.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(SDK_JS);
});

games.get('/g/:slug', async (c) => {
  const html = await getGameHtml(c.req.param('slug'));
  if (html === null) return c.text('Game not found', 404);
  c.header('Content-Type', 'text/html; charset=utf-8');
  c.header('X-Content-Type-Options', 'nosniff');
  // Only our shell may frame a game; the game itself can't be framed elsewhere.
  c.header('Content-Security-Policy', `frame-ancestors ${config.publicBaseUrl}`);
  c.header('Cache-Control', 'no-store');
  return c.body(html);
});

// Studio preview: a just-built game, played in a sandboxed iframe on this
// untrusted origin (capability token from the build step). No Arcade SDK — a
// preview doesn't submit scores.
games.get('/preview/:token', (c) => {
  const html = getPreview(c.req.param('token'));
  if (html === null) return c.text('Preview expired — build it again', 404);
  c.header('Content-Type', 'text/html; charset=utf-8');
  c.header('X-Content-Type-Options', 'nosniff');
  // Locked-down CSP for the preview: it's our own pre-tested template, so its one
  // inline <script>/<style> are ours, and sprites are `data:` PNGs — nothing else.
  // `connect-src 'none'` kills any network egress, so even a future template
  // regression could not exfiltrate a spec value. (Scoped to previews only — the
  // public /g/:slug arcade games may legitimately load external assets.)
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
      "img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; " +
      `frame-ancestors ${config.publicBaseUrl}`
  );
  c.header('Cache-Control', 'no-store');
  return c.body(html);
});
