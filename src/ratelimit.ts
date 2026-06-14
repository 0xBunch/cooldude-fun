// In-memory token-bucket rate limiter. Single-replica service => correct here.
// ~20 submissions/minute per key with a burst of 20. Keyed by device + IP.

type Bucket = { tokens: number; last: number };

const CAP = 20;
const REFILL_PER_MS = 20 / 60_000; // 20 tokens per minute
const buckets = new Map<string, Bucket>();

export function allow(key: string): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: CAP, last: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(CAP, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;

  // Keep the map from growing without bound on a long-lived process.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now - v.last > 5 * 60_000) buckets.delete(k);
    }
  }

  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
