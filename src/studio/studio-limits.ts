// Studio-specific limits, separate from the general 20/min submission limiter
// (src/ratelimit.ts). The image endpoints are EXPENSIVE — /asset runs a sharp
// re-encode (CPU + memory), /draw calls a PAID image model — so they get their own,
// much tighter per-IP token buckets. Because `x-forwarded-for` is client-spoofable,
// per-IP limits are only advisory for abuse; the GLOBAL daily Gemini cap below is the
// real backstop on spend. Single-replica service ⇒ in-memory state is correct here.

type Bucket = { tokens: number; last: number };

function limiter(capacity: number, perMinute: number): (key: string) => boolean {
  const refillPerMs = perMinute / 60_000;
  const buckets = new Map<string, Bucket>();
  return (key: string): boolean => {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      buckets.set(key, b);
    }
    b.tokens = Math.min(capacity, b.tokens + (now - b.last) * refillPerMs);
    b.last = now;
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now - v.last > 5 * 60_000) buckets.delete(k);
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

// Per-IP buckets: (burst capacity, tokens refilled per minute).
export const allowAsset = limiter(6, 6); // photo upload + re-encode
export const allowDraw = limiter(4, 4); // paid image generation — tighter
export const allowSessionCreate = limiter(8, 8); // mint a wizard session

// Global daily Gemini budget — one process-wide counter, independent of IP, so XFF
// spoofing can't multiply spend. Resets when the UTC date rolls over.
let geminiDay = '';
let geminiCount = 0;

// Reserve one Gemini call against today's cap; false if the cap is already reached.
export function tryConsumeGeminiBudget(cap: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== geminiDay) {
    geminiDay = today;
    geminiCount = 0;
  }
  if (geminiCount >= cap) return false;
  geminiCount += 1;
  return true;
}

// Give a reserved call back when generation FAILS, so only successful (actually
// billed) images count against the daily spend cap — a failing prompt can't burn
// the shared budget and pause drawing for everyone.
export function refundGeminiBudget(): void {
  if (geminiCount > 0) geminiCount -= 1;
}
