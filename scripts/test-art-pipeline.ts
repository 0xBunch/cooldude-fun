// Art-pipeline verification — proves the sprite security closed loop WITHOUT a
// test framework (mirrors scripts/assemble-phase0.mjs). Run from the repo root:
//
//   npx tsx scripts/test-art-pipeline.ts
//
// Covers: (a) a 400 KB PNG `img` survives DOUBLE base64 through the real template
// atob/TextDecoder decode path byte-for-byte; (b) validateSpriteImg accepts canonical
// and rejects non-canonical / oversize / non-PNG / external-URL; (c) validateSpecPatch
// drops a model-supplied img; (d) mergeSpec keeps a server-set img across a later model
// patch; (e) setSpriteImg bounds-checks arrays and ignores index for hero; plus the
// assembler size cap and PNG backstop. Image-producing code (sharp, Gemini) is NOT
// exercised here — that's the end-to-end preview step.

import sharp from 'sharp';
import { assemble } from '../src/studio/assembler';
import { reencodeToSprite, ImageRejected } from '../src/studio/image';
import {
  finalizeSpec,
  mergeSpec,
  setSpriteImg,
  validateSpecPatch,
  validateSpriteImg,
  type GameSpecPatch,
} from '../src/studio/spec';

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fails.push(name); console.error(`  ✗ ${name}`); }
}

// A synthetic PNG-signed buffer of an exact byte length (content is irrelevant to
// the byte-level pipeline; real rendering is verified in the browser preview step).
function pngBuf(bytes: number): Buffer {
  const b = Buffer.alloc(bytes);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length && i < b.length; i++) b[i] = sig[i];
  return b;
}
function pngUri(bytes: number): string {
  return 'data:image/png;base64,' + pngBuf(bytes).toString('base64');
}

const MAX = 400 * 1024;
const uriMax = pngUri(MAX); // exactly at the cap → allowed

// ---- (b) validateSpriteImg allow-list ------------------------------------------
check('accepts a canonical 400KB PNG data URI', validateSpriteImg(uriMax) === uriMax);
check('rejects > cap', validateSpriteImg(pngUri(MAX + 1)) === null);
check('rejects empty payload', validateSpriteImg('data:image/png;base64,') === null);
check('rejects non-PNG mime prefix', validateSpriteImg('data:image/jpeg;base64,' + pngBuf(64).toString('base64')) === null);
check('rejects external URL', validateSpriteImg('http://evil.example/x.png') === null);
check('rejects a plain glyph string', validateSpriteImg('🐱') === null);
check('rejects valid base64 that is NOT a PNG (wrong signature)', validateSpriteImg('data:image/png;base64,' + Buffer.alloc(64).toString('base64')) === null);
// Non-canonical: a space inside the payload (lenient decoders would tolerate it).
const canonical = pngBuf(64).toString('base64');
check('rejects non-canonical base64 (embedded space)', validateSpriteImg('data:image/png;base64,' + canonical.slice(0, 8) + ' ' + canonical.slice(8)) === null);
check('rejects non-string', validateSpriteImg(12345 as unknown) === null);

// ---- (e) setSpriteImg shape + bounds -------------------------------------------
{
  const s: GameSpecPatch = { hero: { glyph: '🐱' }, good: [{ glyph: '⭐', points: 1 }], bad: [{ glyph: '💣' }] };
  check('setSpriteImg hero ignores index, sets img, keeps glyph', setSpriteImg(s, 'hero', 99, uriMax) === true && s.hero!.img === uriMax && s.hero!.glyph === '🐱');
  check('setSpriteImg good[0] sets img', setSpriteImg(s, 'good', 0, uriMax) === true && s.good![0].img === uriMax && s.good![0].points === 1);
  check('setSpriteImg good[5] out of range → false', setSpriteImg(s, 'good', 5, uriMax) === false);
  check('setSpriteImg rejects a bad img → false', setSpriteImg(s, 'bad', 0, 'http://evil/x') === false && s.bad![0].img === undefined);
}

// ---- (c) the model can never set img -------------------------------------------
{
  const patch = validateSpecPatch({ hero: { glyph: '🐱', img: uriMax }, good: [{ glyph: '⭐', points: 2, img: uriMax }] });
  check('validateSpecPatch drops a model hero.img', patch.hero !== undefined && (patch.hero as { img?: string }).img === undefined);
  check('validateSpecPatch drops a model good[].img', !!patch.good && patch.good[0].img === undefined && patch.good[0].points === 2);
}

// ---- (d) server-set img is sticky across later model patches -------------------
{
  const base: GameSpecPatch = { hero: { glyph: '🐱', img: uriMax }, good: [{ glyph: '⭐', points: 1, img: uriMax }] };
  const patch: GameSpecPatch = { hero: { glyph: '🐶' }, good: [{ glyph: '🌟', points: 3 }] };
  const merged = mergeSpec(base, patch);
  check('mergeSpec keeps hero.img while taking the new glyph', merged.hero!.img === uriMax && merged.hero!.glyph === '🐶');
  check('mergeSpec keeps good[0].img while taking the new glyph', merged.good![0].img === uriMax && merged.good![0].glyph === '🌟');
}

// ---- (a) 400KB img survives DOUBLE base64 through the real template decode ------
{
  const spec = finalizeSpec({ kit: 'catcher', title: 'T', hero: { glyph: '🐱' }, good: [{ glyph: '⭐', points: 1 }], bad: [{ glyph: '💣' }], theme: { bg1: '#000', bg2: '#111', accent: '#0ff', text: '#fff' } });
  setSpriteImg(spec, 'hero', 0, uriMax);
  const html = assemble(spec);
  const m = html.match(/atob\("([A-Za-z0-9+/=]+)"\)/);
  check('assembled HTML contains a base64 spec blob', !!m);
  if (m) {
    // The EXACT decode the kit template runs in the browser.
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0))));
    check('400KB hero.img round-trips byte-for-byte through double base64', decoded?.hero?.img === uriMax);
  }
}

// ---- assembler backstops -------------------------------------------------------
{
  // Size cap: three 400KB sprites push the serialized spec past ~1.5MB.
  const big = finalizeSpec({ kit: 'catcher', title: 'T', hero: { glyph: '🐱' }, good: [{ glyph: '⭐', points: 1 }], bad: [{ glyph: '💣' }], theme: { bg1: '#000', bg2: '#111', accent: '#0ff', text: '#fff' } });
  setSpriteImg(big, 'hero', 0, uriMax);
  setSpriteImg(big, 'good', 0, uriMax);
  setSpriteImg(big, 'bad', 0, uriMax);
  let threwSize = false;
  try { assemble(big); } catch (e) { threwSize = (e as Error).message.includes('maximum size'); }
  check('assemble rejects an oversized spec', threwSize);

  // PNG backstop: an img set OUTSIDE setSpriteImg (tampered) must be caught.
  const tampered = finalizeSpec({ kit: 'catcher', title: 'T', hero: { glyph: '🐱' }, good: [{ glyph: '⭐', points: 1 }], bad: [{ glyph: '💣' }], theme: { bg1: '#000', bg2: '#111', accent: '#0ff', text: '#fff' } });
  (tampered.hero as { img?: string }).img = 'data:image/png;base64,not canonical!!';
  let threwBackstop = false;
  try { assemble(tampered); } catch (e) { threwBackstop = (e as Error).message.includes('PNG allow-list'); }
  check('assemble backstop rejects a tampered non-PNG img', threwBackstop);
}

// ---- image.ts re-encode pipeline (real sharp) ----------------------------------
async function rejects(label: string, buf: Buffer): Promise<void> {
  try {
    await reencodeToSprite(buf);
    check(label, false);
  } catch (e) {
    check(label, e instanceof ImageRejected);
  }
}
async function main(): Promise<void> {
  const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 200, b: 50 } } }).jpeg().toBuffer();
  const webp = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).webp().toBuffer();

  for (const [kind, buf] of [['PNG', png], ['JPEG', jpeg], ['WEBP', webp]] as const) {
    const uri = await reencodeToSprite(buf);
    check(`reencodeToSprite(${kind}) → valid 256² PNG sprite under cap`, validateSpriteImg(uri) === uri);
  }

  await rejects('reencodeToSprite rejects an SVG (script carrier)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
  await rejects('reencodeToSprite rejects a bare RIFF (non-WEBP) container', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]));
  await rejects('reencodeToSprite rejects random non-image bytes', Buffer.from('not an image at all, just text'));
  await rejects('reencodeToSprite rejects a PNG-signed but undecodable buffer', pngBuf(2048));

  console.log(`\nart-pipeline: ${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.error('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
  console.log('✓ all art-pipeline checks passed');
}

void main();
