import pool from '../src/db.js';
import { MysqlRateLimitStore } from '../src/rateLimitStore.js';

try {
  const cases = JSON.parse(process.env.RATE_LIMIT_TEST_CASES ?? '[]') as {key:string;limit:number;windowMs:number}[];
  const store = new MysqlRateLimitStore();
  const result = await Promise.all(cases.map(async (item) => ({allowed:(await store.consume(item.key,item.limit,item.windowMs)).allowed})));
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stderr.write(`rate-limit worker failed: ${error instanceof Error ? error.name : 'error'}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
