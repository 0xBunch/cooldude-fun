// Trusted shell host (cooldude.fun). Serves the arcade UI, its static assets,
// the /make help page, and game thumbnails (plain images — safe on this origin).
// This is the origin that holds the gate cookie, so it ships a strict CSP.

import { Hono, type Context } from 'hono';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { config } from '../config';
import { getThumb } from '../cache';

export const shell = new Hono();

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const asset = (name: string): string => readFileSync(join(PUBLIC_DIR, name), 'utf8');

// Read static assets once at startup — they ship with the deploy.
const FILES = {
  'index.html': asset('index.html'),
  'make.html': asset('make.html'),
  'make.js': asset('make.js'),
  'shell.css': asset('shell.css'),
  'shell.js': asset('shell.js'),
};
type AssetName = keyof typeof FILES;

// Content hash of the shipped assets — appended as ?v= to the asset URLs so every
// deploy busts the browser/CDN cache. Cloudflare overrides our Cache-Control TTL,
// so versioned URLs are the reliable cache-bust.
const ASSET_VER = createHash('sha1')
  .update(FILES['shell.css'] + FILES['shell.js'] + FILES['index.html'] + FILES['make.js'])
  .digest('hex')
  .slice(0, 8);

// Strict CSP for the trusted origin: no inline scripts, games only framed from
// the games origin. Google Fonts is the only external dependency.
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  `frame-src ${config.gamesBaseUrl}; ` +
  "connect-src 'self'; " +
  "frame-ancestors 'self'";

function htmlPage(name: AssetName) {
  return (c: Context) => {
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Content-Security-Policy', CSP);
    c.header('Cache-Control', 'no-cache'); // always revalidate HTML so fresh ?v= links are seen
    const html = FILES[name].replace(/(\/(?:shell\.css|shell\.js|make\.js))"/g, `$1?v=${ASSET_VER}"`);
    return c.body(html);
  };
}

function staticAsset(name: AssetName, type: string) {
  return (c: Context) => {
    c.header('Content-Type', type);
    // URLs are content-versioned (?v=), so they can cache hard and forever.
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(FILES[name]);
  };
}

shell.get('/', htmlPage('index.html'));
shell.get('/make', htmlPage('make.html'));
shell.get('/make.js', staticAsset('make.js', 'application/javascript; charset=utf-8'));
shell.get('/shell.css', staticAsset('shell.css', 'text/css; charset=utf-8'));
shell.get('/shell.js', staticAsset('shell.js', 'application/javascript; charset=utf-8'));

shell.get('/thumb/:slug', async (c) => {
  const thumb = await getThumb(c.req.param('slug'));
  if (!thumb) return c.text('no thumb', 404);
  c.header('Content-Type', thumb.contentType);
  c.header('Cache-Control', 'public, max-age=120');
  return c.body(new Uint8Array(thumb.buffer));
});
