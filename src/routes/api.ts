// Leaderboard API (served on the main/public host only).

import { Hono } from 'hono';
import { config } from '../config';
import { cleanNickname, cleanScore } from '../validate';
import { allow } from '../ratelimit';
import { getGames, getGame } from '../cache';
import { topScores, insertScore, deleteScore } from '../db';

export const api = new Hono();

// Tells the shell where games are served from.
api.get('/session', (c) => {
  return c.json({ gamesBaseUrl: config.gamesBaseUrl });
});

// Game list (from the 60s Drive cache).
api.get('/games', async (c) => {
  const games = await getGames();
  return c.json(
    games.map((g) => ({
      slug: g.slug,
      title: g.title,
      thumbUrl: g.thumbFileId ? `/thumb/${g.slug}` : null,
    }))
  );
});

// Top scores for a game. Open — everyone sees the board.
api.get('/scores/:slug', async (c) => {
  const limit = Number(c.req.query('limit') ?? 10);
  const top = await topScores(c.req.param('slug'), Number.isFinite(limit) ? limit : 10);
  return c.json(top);
});

// Submit a score. Validated + rate-limited + profanity-checked.
api.post('/scores', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const game = await getGame(String(body?.slug ?? ''));
  if (!game) return c.json({ ok: false, error: 'unknown game' }, 400);

  const nick = cleanNickname(body?.nickname);
  if (!nick.ok) return c.json({ ok: false, error: nick.error }, 400);

  const score = cleanScore(body?.score);
  if (!score.ok) return c.json({ ok: false, error: score.error }, 400);

  const deviceId = String(c.req.header('x-device-id') ?? 'anon').slice(0, 64);
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'ip';
  if (!allow(`${deviceId}:${ip}`)) return c.json({ ok: false, error: 'slow down a sec!' }, 429);

  await insertScore(game.slug, nick.value, score.value);
  const top = await topScores(game.slug, 10);
  return c.json({ ok: true, top });
});

// Owner-only moderation: delete a score row by id.
api.delete('/scores/:id', async (c) => {
  if (!config.adminToken || c.req.header('x-admin-token') !== config.adminToken) {
    return c.json({ ok: false }, 403);
  }
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  return c.json({ ok: await deleteScore(id) });
});
