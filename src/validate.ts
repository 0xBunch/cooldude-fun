// Validation for score submissions. Nicknames are kid-facing, so we constrain
// the charset and run a profanity filter (with light l33t normalization).
// Scores are clamped to a sane integer range — they are inherently forgeable
// client-side and we accept that for a friends-only arcade.

import leoProfanity from 'leo-profanity';

let profanityReady = false;
function ensureProfanity(): void {
  if (!profanityReady) {
    leoProfanity.loadDictionary();
    profanityReady = true;
  }
}

const NICK_RE = /^[A-Za-z0-9 _-]{1,16}$/;
const LEET: Record<string, string> = {
  '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', $: 's', '5': 's', '7': 't',
};

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function cleanNickname(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'nickname required' };
  const value = raw.trim();
  if (!NICK_RE.test(value)) {
    return { ok: false, error: 'name must be 1–16 letters, numbers, spaces, _ or -' };
  }
  ensureProfanity();
  const normalized = value.toLowerCase().replace(/[@4310!$57]/g, (ch) => LEET[ch] ?? ch);
  if (leoProfanity.check(value) || leoProfanity.check(normalized)) {
    return { ok: false, error: 'please pick a cleaner name' };
  }
  return { ok: true, value };
}

export function cleanScore(raw: unknown): Validated<number> {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: 'score must be a number' };
  const value = Math.floor(n);
  if (value < 0 || value > 1_000_000_000) return { ok: false, error: 'score out of range' };
  return { ok: true, value };
}
