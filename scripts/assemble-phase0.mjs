// Phase 0 assembler — proves the real pipeline's core move on a tiny scale:
// take a kit template + a JSON spec, inject the spec as a base64(UTF-8) blob,
// and write a standalone playable .html. No AI, no server, no deps.
//
//   node scripts/assemble-phase0.mjs
//
// Each spec names its kit (spec.kit); the matching template is loaded from
// src/studio/kits/templates/<kit>.html. Mirrors the security contract of the
// future src/studio/assembler.ts:
//   - the spec is base64-encoded so no spec value lands as raw HTML
//   - the blob is asserted to be pure base64 before it is injected
//   - the assembled HTML is asserted to contain no unreplaced token
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMPLATE_DIR = join(ROOT, 'src/studio/kits/templates');
const SPECS_DIR = join(ROOT, 'studio-phase0/specs');
const OUT_DIR = join(ROOT, 'studio-phase0');

const B64 = /^[A-Za-z0-9+/=]+$/;
const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';

const templates = {};
function loadTemplate(kit) {
  if (!templates[kit]) {
    const t = readFileSync(join(TEMPLATE_DIR, `${kit}.html`), 'utf8');
    if (!t.includes('{{SPEC_JSON}}')) throw new Error(`template ${kit}.html missing {{SPEC_JSON}} token`);
    templates[kit] = t;
  }
  return templates[kit];
}

mkdirSync(OUT_DIR, { recursive: true });
const specFiles = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.json'));

for (const f of specFiles) {
  const spec = JSON.parse(readFileSync(join(SPECS_DIR, f), 'utf8'));
  const template = loadTemplate(String(spec.kit || 'catcher'));
  const blob = Buffer.from(JSON.stringify(spec), 'utf8').toString('base64');
  if (!B64.test(blob)) throw new Error(`non-base64 blob for ${f}`); // H2 safety assert
  const html = template.split('{{SPEC_JSON}}').join(blob); // replace ALL occurrences
  if (html.includes('{{SPEC_JSON}}')) throw new Error(`unreplaced token remains in ${f}`);
  const name = slugify(spec.title || f.replace(/\.json$/, ''));
  const out = join(OUT_DIR, `${name}.html`);
  writeFileSync(out, html);
  console.log(`wrote ${out}  [${spec.kit || 'catcher'}]  (${(html.length / 1024).toFixed(1)} KB)`);
}
console.log(`done: ${specFiles.length} game(s)`);
