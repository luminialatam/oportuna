export interface RateLimitDecision { allowed: boolean; retryAfterSeconds: number; }
export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
  check(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  async check(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    const start = Math.floor(now / windowMs) * windowMs;
    const bucket = this.buckets.get(key);
    return { allowed: !(bucket && bucket.start === start && bucket.count >= limit), retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }
  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    const start = Math.floor(now / windowMs) * windowMs;
    const current = this.buckets.get(key);
    const bucket = !current || current.start !== start ? { start, count: 0 } : current;
    bucket.count++;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 5000) for (const [id, value] of this.buckets) if (value.start + windowMs <= now) this.buckets.delete(id);
    return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }
}
