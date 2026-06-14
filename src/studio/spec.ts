// The game spec is the contract between the wizard, the kits, and the assembler.
// It is a small, FLAT, allow-listed object. The wizard (Claude) proposes values;
// EVERY field is re-validated here server-side before it is trusted or assembled
// (security H1/H2: the model is a chooser within a fixed parameter space, never a
// source of code or markup).

import leoProfanity from 'leo-profanity';

export type KitId = 'catcher' | 'dodger' | 'shooter';
export const KIT_IDS: KitId[] = ['catcher', 'dodger', 'shooter'];

// A sprite is an emoji `glyph` (always present — the guaranteed canvas fallback)
// plus an OPTIONAL custom `img`: a `data:image/png;base64,…` URI for a kid-made
// look (generated or uploaded). `img` is NEVER model-proposable — it is set only
// by the server via setSpriteImg() → validateSpriteImg() (the sole gate).
export type Sprite = { glyph: string; img?: string };
export type GoodItem = { glyph: string; points: number; img?: string };
export type Theme = { bg1: string; bg2: string; accent: string; text: string };
export type ArtSlot = 'hero' | 'good' | 'bad';

export type GameSpec = {
  kit: KitId;
  title: string;
  theme: Theme;
  hero: Sprite;
  good: GoodItem[];
  bad: Sprite[];
  speed: number;
  lives: number;
  goalText: string;
};

// A patch is a partial spec. `theme` is partial too, so the wizard can set one
// color channel at a time and they merge (mergeSpec), instead of clobbering.
export type GameSpecPatch = Partial<Omit<GameSpec, 'theme'>> & { theme?: Partial<Theme> };

// One step of the wizard, as proposed by Claude (via tool use) and re-validated here.
export type WizardStep = {
  prompt: string; // what the buddy says — one short, kid-friendly sentence
  chips: string[]; // tappable options (may be empty)
  allowFreeform: boolean; // show the talk/type box?
  specPatch: GameSpecPatch | null; // validated fields to set, or null
  artSlot: ArtSlot | null; // when set, the SPA offers 🎨 Draw / 📷 Upload for this character
  done: boolean; // spec complete enough to build?
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;
// A sprite image is ONLY ever a PNG data URI whose payload is CANONICAL base64
// (RFC 4648: full quads, then an optional 2-char `==` or 3-char `=` tail). The
// strict charset + the round-trip check in validateSpriteImg reject the lenient,
// whitespace-tolerant forms that `atob`/`Buffer.from` would otherwise accept.
const PNG_DATA_URI = /^data:image\/png;base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/;
const MAX_SPRITE_BYTES = 400 * 1024; // ≤ ~400 KB of decoded PNG per sprite
// Positive allow-list: emoji pictographs + ZWJ (U+200D) + variation selector
// (U+FE0F) + skin-tone and flag (regional-indicator) components. Excludes ASCII,
// control chars, RLO/ZWSP, HTML entities, and digits/#/* — a glyph is only ever
// a real emoji.
const GLYPH_OK = /^(?:\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|[\u{1F1E6}-\u{1F1FF}]|\\u200d|\u{FE0F})+$/u;
const DEFAULT_THEME: Theme = { bg1: '#16123a', bg2: '#0a0a1e', accent: '#00e5ff', text: '#ffffff' };

let profReady = false;
function screen(s: string): string {
  if (!profReady) {
    leoProfanity.loadDictionary();
    profReady = true;
  }
  return leoProfanity.check(s) ? leoProfanity.clean(s) : s;
}

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== 'number' && typeof v !== 'string') return dflt; // reject bool/null/array coercion
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

// One emoji glyph: real emoji only, and short enough to be a single glyph (a ZWJ
// family sequence is ~11 UTF-16 units). Rejected (not clipped) if too long, so we
// never truncate mid-codepoint.
function cleanGlyph(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const g = v.trim();
  if (!g || g.length > 16 || !GLYPH_OK.test(g)) return null;
  return g;
}

// Kid-facing text: markup-stripped, length-capped, profanity-screened.
// NOTE: output is safe for textContent only — a UI must never innerHTML it.
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = screen(v.replace(/[<>]/g, '').trim().slice(0, max));
  return s || null;
}

function validHex(v: unknown): string | null {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : null;
}

// THE single VALIDATOR for a sprite image — the only function that decides whether an
// `img` is safe (the assembler backstop at assembly re-invokes this very function; no
// other code validates `img`). By design it verifies OUR OWN re-encoded output (image.ts →
// data URI built from a sharp PNG buffer), never a client-supplied URI: it must
// be a PNG data URI with canonical base64, decode to 1..MAX_SPRITE_BYTES bytes,
// round-trip byte-for-byte (rejecting any non-canonical payload a lenient decoder
// would have silently reshaped), and carry the real PNG signature.
export function validateSpriteImg(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = PNG_DATA_URI.exec(v);
  if (!m) return null;
  const b64 = m[1] ?? '';
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0 || buf.length > MAX_SPRITE_BYTES) return null;
  if (buf.toString('base64') !== b64) return null; // reject non-canonical input
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A.
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return v;
}

// The ONLY way an `img` is written onto a spec. Owns spec-shape knowledge so route
// handlers never index into the spec themselves: `hero` is a single sprite (index
// ignored), `good`/`bad` are arrays (index bounds-checked). Returns false — caller
// maps to a 4xx — on an out-of-range slot/index or an image that fails the gate.
// The existing emoji `glyph` is preserved as the fallback.
export function setSpriteImg(spec: GameSpecPatch, slot: ArtSlot, index: number, rawImg: unknown): boolean {
  const img = validateSpriteImg(rawImg);
  if (!img) return false;
  if (slot === 'hero') {
    spec.hero = { glyph: spec.hero?.glyph ?? '🧺', img };
    return true;
  }
  if (!Number.isInteger(index) || index < 0) return false;
  // Branch by slot so the element type is concrete (good = GoodItem, bad = Sprite);
  // an out-of-range index reads as undefined → false.
  if (slot === 'good') {
    const cur = spec.good?.[index];
    if (!cur) return false;
    spec.good![index] = { ...cur, img };
    return true;
  }
  const cur = spec.bad?.[index];
  if (!cur) return false;
  spec.bad![index] = { ...cur, img };
  return true;
}

// Re-validate a model-proposed patch against the allow-list. Anything off-list,
// malformed, or unsafe is dropped — never trusted as supplied.
export function validateSpecPatch(raw: unknown): GameSpecPatch {
  const patch: GameSpecPatch = {};
  if (!raw || typeof raw !== 'object') return patch;
  const p = raw as Record<string, unknown>;

  if (typeof p.kit === 'string' && (KIT_IDS as string[]).includes(p.kit)) {
    patch.kit = p.kit as KitId;
  }
  const title = cleanText(p.title, 40);
  if (title) patch.title = title;
  const goal = cleanText(p.goalText, 120);
  if (goal) patch.goalText = goal;

  const heroGlyph = p.hero && typeof p.hero === 'object' ? cleanGlyph((p.hero as Record<string, unknown>).glyph) : null;
  if (heroGlyph) patch.hero = { glyph: heroGlyph };

  if (Array.isArray(p.good)) {
    const good: GoodItem[] = [];
    for (const it of p.good.slice(0, 4)) {
      const rec = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      const g = cleanGlyph(rec.glyph);
      if (g) good.push({ glyph: g, points: Math.round(clampNum(rec.points, 1, 9, 1)) });
    }
    if (good.length) patch.good = good;
  }
  if (Array.isArray(p.bad)) {
    const bad: Sprite[] = [];
    for (const it of p.bad.slice(0, 4)) {
      const rec = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      const g = cleanGlyph(rec.glyph);
      if (g) bad.push({ glyph: g });
    }
    if (bad.length) patch.bad = bad;
  }
  // Only keep the color channels the model actually supplied with valid hex — no
  // defaulting here, so a partial/garbage theme can't masquerade as a full one.
  if (p.theme && typeof p.theme === 'object') {
    const t = p.theme as Record<string, unknown>;
    const theme: Partial<Theme> = {};
    const bg1 = validHex(t.bg1);
    const bg2 = validHex(t.bg2);
    const accent = validHex(t.accent);
    const text = validHex(t.text);
    if (bg1) theme.bg1 = bg1;
    if (bg2) theme.bg2 = bg2;
    if (accent) theme.accent = accent;
    if (text) theme.text = text;
    if (Object.keys(theme).length) patch.theme = theme;
  }
  if (p.speed !== undefined) patch.speed = clampNum(p.speed, 0.5, 2, 1);
  if (p.lives !== undefined) patch.lives = Math.round(clampNum(p.lives, 1, 5, 3));
  return patch;
}

// Shallow merge, EXCEPT (a) theme merges channel-wise so a one-color patch doesn't
// wipe colors set on earlier turns, and (b) a server-set sprite `img` is STICKY:
// model patches never carry `img` (validateSpecPatch drops it), so a later patch
// that re-sends hero/good/bad would otherwise clobber a custom look the kid made.
// We carry the prior `img` forward by slot (and by array position for good/bad).
export function mergeSpec(base: GameSpecPatch, patch: GameSpecPatch): GameSpecPatch {
  const merged: GameSpecPatch = { ...base, ...patch };
  if (base.theme || patch.theme) merged.theme = { ...base.theme, ...patch.theme };
  if (patch.hero && base.hero?.img && !patch.hero.img) {
    merged.hero = { ...patch.hero, img: base.hero.img };
  }
  if (patch.good && base.good) {
    merged.good = patch.good.map((it, i) => (base.good![i]?.img && !it.img ? { ...it, img: base.good![i].img } : it));
  }
  if (patch.bad && base.bad) {
    merged.bad = patch.bad.map((it, i) => (base.bad![i]?.img && !it.img ? { ...it, img: base.bad![i].img } : it));
  }
  return merged;
}

// Fields each kit needs before it can be assembled.
const REQUIRED: Record<KitId, (keyof GameSpec)[]> = {
  catcher: ['title', 'hero', 'good', 'bad', 'theme'],
  dodger: ['title', 'hero', 'bad', 'theme'],
  shooter: ['title', 'hero', 'good', 'theme'],
};

export function isSpecComplete(spec: GameSpecPatch): boolean {
  if (!spec.kit || !KIT_IDS.includes(spec.kit)) return false;
  return REQUIRED[spec.kit].every((k) => spec[k] !== undefined);
}

// Fill any unset fields (and theme channels) with safe defaults so a
// complete-enough spec always assembles into a playable game.
export function finalizeSpec(spec: GameSpecPatch): GameSpec {
  const kit: KitId = spec.kit && KIT_IDS.includes(spec.kit) ? spec.kit : 'catcher';
  return {
    kit,
    title: spec.title || 'My Game',
    theme: {
      bg1: spec.theme?.bg1 ?? DEFAULT_THEME.bg1,
      bg2: spec.theme?.bg2 ?? DEFAULT_THEME.bg2,
      accent: spec.theme?.accent ?? DEFAULT_THEME.accent,
      text: spec.theme?.text ?? DEFAULT_THEME.text,
    },
    hero: spec.hero || { glyph: '🧺' },
    good: spec.good || [{ glyph: '⭐', points: 1 }],
    bad: spec.bad || [{ glyph: '💣' }],
    speed: spec.speed ?? 1,
    lives: spec.lives ?? 3,
    goalText: spec.goalText || 'Have fun!',
  };
}
