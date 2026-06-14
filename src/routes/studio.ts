// Studio API (served on the trusted public host at /api/studio). Drives the
// wizard, then builds a game server-side from the validated spec and hands back a
// sandboxed preview URL on the games origin. Everything past the gate is locked.

import { Hono, type Context } from 'hono';
import { config } from '../config';
import { allow } from '../ratelimit';
import { isStudioGated, setStudioGate, studioCodeMatches, studioEnabled } from '../studio/gate-studio';
import { getSession, startSession, turn } from '../studio/wizard';
import { finalizeSpec } from '../studio/spec';
import { assemble } from '../studio/assembler';
import { putPreview } from '../studio/preview-store';

export const studio = new Hono();

function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'ip';
}

studio.get('/status', async (c) => {
  return c.json({ enabled: studioEnabled(), gated: await isStudioGated(c), gamesBaseUrl: config.gamesBaseUrl });
});

studio.post('/gate', async (c) => {
  if (!studioEnabled()) return c.json({ ok: false, error: 'studio not set up yet' }, 503);
  if (!allow(`studio-gate:${clientIp(c)}`)) return c.json({ ok: false, error: 'slow down a sec' }, 429);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (!studioCodeMatches(body?.code)) return c.json({ ok: false, error: 'wrong code' }, 401);
  await setStudioGate(c);
  return c.json({ ok: true });
});

studio.post('/session', async (c) => {
  if (!(await isStudioGated(c))) return c.json({ ok: false, error: 'locked' }, 403);
  const session = startSession();
  const step = await turn(session.id, '');
  return c.json({ ok: true, sessionId: session.id, step });
});

studio.post('/session/:id/turn', async (c) => {
  if (!(await isStudioGated(c))) return c.json({ ok: false, error: 'locked' }, 403);
  if (!allow(`studio-turn:${clientIp(c)}`)) return c.json({ ok: false, error: 'slow down a sec' }, 429);
  const id = c.req.param('id');
  if (!getSession(id)) return c.json({ ok: false, error: 'session expired' }, 404);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const input = String(body?.input ?? '').slice(0, 500);
  const step = await turn(id, input);
  return c.json({ ok: true, step });
});

studio.post('/session/:id/build', async (c) => {
  if (!(await isStudioGated(c))) return c.json({ ok: false, error: 'locked' }, 403);
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ ok: false, error: 'session expired' }, 404);
  try {
    const spec = finalizeSpec(session.spec); // server-side: client never supplies HTML
    const token = putPreview(assemble(spec));
    return c.json({ ok: true, previewUrl: `${config.gamesBaseUrl}/preview/${token}`, title: spec.title });
  } catch (e) {
    console.error('[studio] build failed:', e instanceof Error ? e.message : e);
    return c.json({ ok: false, error: 'could not build the game' }, 500);
  }
});
