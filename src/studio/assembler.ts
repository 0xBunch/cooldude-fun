// Assembler — turns a validated GameSpec into one self-contained HTML game by
// injecting the spec into the chosen kit template. This is the security-critical
// seam: the spec is base64-encoded so no spec value ever lands as raw HTML, the
// blob is asserted to be pure base64 before injection, and the result is asserted
// to contain no unreplaced token. (Mirrors scripts/assemble-phase0.mjs.)
//
// Custom sprite art (generated or uploaded) rides inside the spec as `img` PNG
// data URIs. validateSpriteImg() is the sole gate that produced them; the backstop
// below RE-ASSERTS every `img` is a clean PNG data URI at this final seam, and the
// whole serialized spec is size-capped before it is base64-encoded a second time.

import { readFileSync } from 'fs';
import { join } from 'path';
import { KIT_IDS, validateSpriteImg, type GameSpec, type GoodItem, type Sprite } from './spec';

const B64 = /^[A-Za-z0-9+/=]+$/;
const MAX_SPEC_BYTES = 1.5 * 1024 * 1024; // ~1.5 MB serialized spec (a few 400 KB sprites + JSON)
const TEMPLATE_DIR = join(process.cwd(), 'src', 'studio', 'kits', 'templates');

// Backstop: every sprite `img` must still pass the same allow-list that created it.
// validateSpriteImg is the sole gate, so this guards against a future code path that
// sets `img` without going through setSpriteImg.
function assertSpritesPng(spec: GameSpec): void {
  const sprites: Array<Sprite | GoodItem> = [spec.hero, ...spec.good, ...spec.bad];
  for (const s of sprites) {
    if (s && s.img !== undefined && validateSpriteImg(s.img) === null) {
      throw new Error('a sprite img failed the PNG allow-list at assembly');
    }
  }
}

export function assemble(spec: GameSpec): string {
  // Self-defending: never let an unexpected kit value reach the path join, even
  // if a caller forgets to validate (defense against path traversal).
  if (!KIT_IDS.includes(spec.kit)) throw new Error(`unknown kit: ${String(spec.kit)}`);
  assertSpritesPng(spec);
  const template = readFileSync(join(TEMPLATE_DIR, `${spec.kit}.html`), 'utf8');
  if (!template.includes('{{SPEC_JSON}}')) {
    throw new Error(`kit template ${spec.kit}.html is missing the {{SPEC_JSON}} token`);
  }
  const json = JSON.stringify(spec);
  if (Buffer.byteLength(json, 'utf8') > MAX_SPEC_BYTES) throw new Error('spec exceeds the maximum size');
  const blob = Buffer.from(json, 'utf8').toString('base64');
  if (!B64.test(blob)) throw new Error('spec did not base64-encode cleanly');
  const html = template.split('{{SPEC_JSON}}').join(blob);
  if (html.includes('{{SPEC_JSON}}')) throw new Error('unreplaced token remains after assembly');
  return html;
}
