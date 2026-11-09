import { createHash } from 'node:crypto';
import pool from './db.js';
import { loadRuntimeConfig } from './runtimeConfig.js';

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

export class MysqlRateLimitStore implements RateLimitStore {
  private nextCleanupAt = 0;
  async check(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    const start = Math.floor(now / windowMs) * windowMs;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const [rows] = await pool.execute<any[]>('SELECT hit_count FROM app_rate_limits WHERE key_hash=? AND window_start_ms=?', [keyHash, start]);
    return { allowed: Number(rows[0]?.hit_count ?? 0) < limit, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }
  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    const start = Math.floor(now / windowMs) * windowMs;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const expiresAt = new Date(start + windowMs + 60_000);
    await pool.execute(`INSERT INTO app_rate_limits (key_hash,window_start_ms,hit_count,expires_at)
      VALUES (?,?,1,?) ON DUPLICATE KEY UPDATE hit_count=hit_count+1,expires_at=VALUES(expires_at)`, [keyHash, start, expiresAt]);
    if (now >= this.nextCleanupAt) {
      this.nextCleanupAt = now + 60_000;
      await pool.execute('DELETE FROM app_rate_limits WHERE expires_at<UTC_TIMESTAMP() LIMIT 1000');
    }
    const [rows] = await pool.execute<any[]>('SELECT hit_count FROM app_rate_limits WHERE key_hash=? AND window_start_ms=?', [keyHash, start]);
    return { allowed: Number(rows[0]?.hit_count ?? limit + 1) <= limit, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
  }
}

const memoryStore = new MemoryRateLimitStore();
const mysqlStore = new MysqlRateLimitStore();
export async function consumeRateLimit(key: string, limit: number, windowMs: number, now?: number) {
  const config = loadRuntimeConfig();
  return (config.sharedRateLimits ? mysqlStore : memoryStore).consume(key, limit, windowMs, now);
}

export async function checkRateLimit(key: string, limit: number, windowMs: number, now?: number) {
  const config = loadRuntimeConfig();
  return (config.sharedRateLimits ? mysqlStore : memoryStore).check(key, limit, windowMs, now);
}
