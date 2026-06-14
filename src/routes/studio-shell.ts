// Serves the Studio phone app at /studio on the trusted public host. Strict
// script-src; inline styles allowed for the self-contained page; game previews
// are framed only from the games origin.

import { Hono, type Context } from 'hono';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { config } from '../config';

export const studioShell = new Hono();

const DIR = join(__dirname, '..', '..', 'public-studio');
const HTML = readFileSync(join(DIR, 'studio.html'), 'utf8');
const JS = readFileSync(join(DIR, 'studio.js'), 'utf8');
const VER = createHash('sha1').update(HTML + JS).digest('hex').slice(0, 8);

const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  `frame-src ${config.gamesBaseUrl}; ` +
  "connect-src 'self'; " +
  "frame-ancestors 'self'";

studioShell.get('/', (c: Context) => {
  c.header('Content-Type', 'text/html; charset=utf-8');
  c.header('Content-Security-Policy', CSP);
  c.header('Cache-Control', 'no-cache');
  return c.body(HTML.replace('/studio/studio.js"', `/studio/studio.js?v=${VER}"`));
});

studioShell.get('/studio.js', (c: Context) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(JS);
});
