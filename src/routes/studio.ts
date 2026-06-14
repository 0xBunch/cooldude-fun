// Studio API (served on the trusted public host at /api/studio). Drives the
// wizard, then builds a game server-side from the validated spec and hands back a
// sandboxed preview URL on the games origin. Everything past the gate is locked.

import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { config } from '../config';
import { allow } from '../ratelimit';
import { allowAsset, allowDraw, allowSessionCreate, refundGeminiBudget, tryConsumeGeminiBudget } from '../studio/studio-limits';
import { isStudioGated, setStudioGate, studioCodeMatches, studioEnabled } from '../studio/gate-studio';
import { getSession, startSession, turn, IMAGE_CAP } from '../studio/wizard';
import { cleanText, finalizeSpec, setSpriteImg, type ArtSlot } from '../studio/spec';
import { reencodeToSprite, ImageRejected } from '../studio/image';
import { getArtProvider, isStubArt } from '../studio/art-provider';
import { assemble } from '../studio/assembler';
import { putPreview } from '../studio/preview-store';

export const studio = new Hono();

const ART_SLOTS: ArtSlot[] = ['hero', 'good', 'bad'];
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024; // base64-in-JSON body cap (~4.4 MB raw image)

// The kid's "draw" description: profanity/markup-screened + length-capped by cleanText,
// then newlines/control chars collapsed so it cannot inject a second instruction line
// into the templated prompt below.
function cleanArtDesc(v: unknown): string | null {
  const t = cleanText(v, 80);
  if (!t) return null;
  const flat = t.replace(/\s+/g, " ").trim();
  return flat || null;
}

// The prompt is TEMPLATED server-side; the kid's screened text only ever fills {desc}.
function buildArtPrompt(desc: string): string {
  return `cute pixel-art game sprite of ${desc}, simple, bold, thick outline, centered, on a plain white background, kid-friendly, no text, no words`;
}

function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'ip';
}

// A custom-art request targets a sprite slot + index. `index` is passed through raw —
// setSpriteImg is the sole arbiter of index validity (integer, in range; ignored for hero).
function readSlot(body: Record<string, unknown>): { slot: ArtSlot; index: number } | null {
  const slot = body?.slot;
  if (typeof slot !== 'string' || !ART_SLOTS.includes(slot as ArtSlot)) return null;
  return { slot: slot as ArtSlot, index: Number(body?.index ?? 0) };
}

// Decode the uploaded `image` field: base64, with an optional data: URL prefix we
// strip. The route's bodyLimit bounds the size; here we only sanity-check the charset.
function decodeImageField(v: unknown): Buffer | null {
  if (typeof v !== 'string' || v.length < 16) return null;
  const b64 = v.startsWith('data:') ? v.slice(v.indexOf(',') + 1) : v;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length ? buf : null;
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
  if (!allowSessionCreate(`studio-session:${clientIp(c)}`)) return c.json({ ok: false, error: 'slow down a sec' }, 429);
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

// Upload path (security-critical): a kid's photo/drawing → re-encoded sprite. The
// bytes are never trusted — image.ts magic-byte-checks and re-encodes via sharp;
// setSpriteImg is the sole gate that writes the result onto the spec.
studio.post(
  '/session/:id/asset',
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ ok: false, error: 'that picture is too big' }, 413) }),
  async (c) => {
    if (!(await isStudioGated(c))) return c.json({ ok: false, error: 'locked' }, 403);
    if (!allowAsset(`studio-asset:${clientIp(c)}`)) return c.json({ ok: false, error: 'slow down a sec' }, 429);
    const session = getSession(c.req.param('id'));
    if (!session) return c.json({ ok: false, error: 'session expired' }, 404);
    if (session.imageCount >= IMAGE_CAP) return c.json({ ok: false, error: "that's enough pictures for now!" }, 429);

    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const target = readSlot(body);
    if (!target) return c.json({ ok: false, error: 'bad slot' }, 400);
    const buf = decodeImageField(body?.image);
    if (!buf) return c.json({ ok: false, error: 'no picture' }, 400);

    try {
      const uri = await reencodeToSprite(buf);
      if (!setSpriteImg(session.spec, target.slot, target.index, uri)) {
        return c.json({ ok: false, error: 'pick a character first' }, 400);
      }
      session.imageCount += 1;
      return c.json({ ok: true, img: uri });
    } catch (e) {
      if (e instanceof ImageRejected) return c.json({ ok: false, error: "that picture didn't work — try another!" }, 422);
      console.error('[studio] asset failed:', e instanceof Error ? e.message : e);
      return c.json({ ok: false, error: 'could not use that picture' }, 500);
    }
  }
);

// Generate path: a kid's description → AI sprite. The prompt is templated server-side
// (kid text only fills {desc}); generated bytes go through the SAME reencodeToSprite +
// setSpriteImg gate as uploads. Real generation is gated by a global daily budget; the
// keyless stub is free and skips it.
studio.post('/session/:id/draw', async (c) => {
  if (!(await isStudioGated(c))) return c.json({ ok: false, error: 'locked' }, 403);
  if (!allowDraw(`studio-draw:${clientIp(c)}`)) return c.json({ ok: false, error: 'slow down a sec' }, 429);
  const session = getSession(c.req.param('id'));
  if (!session) return c.json({ ok: false, error: 'session expired' }, 404);
  if (session.imageCount >= IMAGE_CAP) return c.json({ ok: false, error: "that's enough pictures for now!" }, 429);

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const target = readSlot(body);
  if (!target) return c.json({ ok: false, error: 'bad slot' }, 400);
  const desc = cleanArtDesc(body?.description);
  if (!desc) return c.json({ ok: false, error: 'tell me what to draw!' }, 400);

  // Global spend backstop — only gate REAL generation (the stub is free).
  const tookBudget = !isStubArt();
  if (tookBudget && !tryConsumeGeminiBudget(config.geminiDailyCap)) {
    return c.json({ ok: false, error: 'drawing is taking a little break — try again later!' }, 503);
  }

  try {
    const bytes = await getArtProvider().generate(buildArtPrompt(desc));
    const uri = await reencodeToSprite(bytes);
    if (!setSpriteImg(session.spec, target.slot, target.index, uri)) {
      return c.json({ ok: false, error: 'pick a character first' }, 400);
    }
    session.imageCount += 1;
    return c.json({ ok: true, img: uri });
  } catch (e) {
    if (tookBudget) refundGeminiBudget(); // a failed generation must not burn the shared daily cap
    if (e instanceof ImageRejected) return c.json({ ok: false, error: "that drawing didn't work — try another idea!" }, 422);
    console.error('[studio] draw failed:', e instanceof Error ? e.message : e);
    return c.json({ ok: false, error: "couldn't draw that — try again" }, 500);
  }
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
