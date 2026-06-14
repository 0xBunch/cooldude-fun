// The game spec is the contract between the wizard, the kits, and the assembler.
// It is a small, FLAT, allow-listed object. The wizard (Claude) proposes values;
// EVERY field is re-validated here server-side before it is trusted or assembled
// (security H1/H2: the model is a chooser within a fixed parameter space, never a
// source of code or markup).

import leoProfanity from 'leo-profanity';

export type KitId = 'catcher' | 'dodger' | 'shooter';
export const KIT_IDS: KitId[] = ['catcher', 'dodger', 'shooter'];

export type Sprite = { glyph: string };
export type GoodItem = { glyph: string; points: number };
export type Theme = { bg1: string; bg2: string; accent: string; text: string };

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
  done: boolean; // spec complete enough to build?
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;
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

// Shallow merge, EXCEPT theme merges channel-wise so a one-color patch doesn't
// wipe colors set on earlier turns.
export function mergeSpec(base: GameSpecPatch, patch: GameSpecPatch): GameSpecPatch {
  const merged: GameSpecPatch = { ...base, ...patch };
  if (base.theme || patch.theme) merged.theme = { ...base.theme, ...patch.theme };
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
