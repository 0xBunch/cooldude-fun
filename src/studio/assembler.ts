// Assembler — turns a validated GameSpec into one self-contained HTML game by
// injecting the spec into the chosen kit template. This is the security-critical
// seam: the spec is base64-encoded so no spec value ever lands as raw HTML, the
// blob is asserted to be pure base64 before injection, and the result is asserted
// to contain no unreplaced token. (Mirrors scripts/assemble-phase0.mjs.)
//
// Art is not handled yet — the v1 wizard produces emoji specs that the kit
// templates render directly. Phase 4 (Gemini) will extend this to embed base64
// PNG data URIs alongside the spec.

import { readFileSync } from 'fs';
import { join } from 'path';
import { KIT_IDS, type GameSpec } from './spec';

const B64 = /^[A-Za-z0-9+/=]+$/;
const TEMPLATE_DIR = join(process.cwd(), 'src', 'studio', 'kits', 'templates');

export function assemble(spec: GameSpec): string {
  // Self-defending: never let an unexpected kit value reach the path join, even
  // if a caller forgets to validate (defense against path traversal).
  if (!KIT_IDS.includes(spec.kit)) throw new Error(`unknown kit: ${String(spec.kit)}`);
  const template = readFileSync(join(TEMPLATE_DIR, `${spec.kit}.html`), 'utf8');
  if (!template.includes('{{SPEC_JSON}}')) {
    throw new Error(`kit template ${spec.kit}.html is missing the {{SPEC_JSON}} token`);
  }
  const blob = Buffer.from(JSON.stringify(spec), 'utf8').toString('base64');
  if (!B64.test(blob)) throw new Error('spec did not base64-encode cleanly');
  const html = template.split('{{SPEC_JSON}}').join(blob);
  if (html.includes('{{SPEC_JSON}}')) throw new Error('unreplaced token remains after assembly');
  return html;
}
