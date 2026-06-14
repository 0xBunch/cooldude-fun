// COOL DUDE'S ARCADE — single service, two hostnames, one database.
//   public host (cooldude.fun):        arcade shell + /api + thumbnails
//   games host  (games.cooldude.fun):  untrusted game HTML + the SDK
// In local dev both are the same origin and the iframe sandbox is the boundary.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config';
import { initDb, usingMemory } from './db';
import { getProvider } from './drive';
import { refresh, startRefreshLoop } from './cache';
import { api } from './routes/api';
import { games } from './routes/games';
import { shell } from './routes/shell';

const app = new Hono();

// Baseline security headers on every response.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

// Trust boundary. In prod the games host and public host are different domains:
// refuse public/API routes on the games host and game routes on the public host.
function isGamesPath(p: string): boolean {
  return p === '/arcade-sdk.js' || p.startsWith('/g/');
}
app.use('*', async (c, next) => {
  if (config.sameHost) return next(); // dev: one origin; the sandbox is the boundary
  const onGamesHost = (c.req.header('host') || '') === config.gamesHost;
  if (onGamesHost !== isGamesPath(c.req.path)) return c.text('Not found', 404);
  return next();
});

app.route('/api', api);
app.route('/', games);
app.route('/', shell);

async function main(): Promise<void> {
  await initDb();
  startRefreshLoop();
  void refresh(); // prime the games cache

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(
      `\n  COOL DUDE'S ARCADE  ▸  http://localhost:${info.port}\n` +
        `  db: ${usingMemory() ? 'in-memory' : 'postgres'}   ` +
        `games: ${getProvider().mode}   ` +
        `hosts: ${config.sameHost ? 'single-origin (dev)' : `${config.publicHost} + ${config.gamesHost}`}\n`
    );
  });
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
