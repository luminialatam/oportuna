import assert from 'node:assert/strict';
import pool from '../src/db.js';

process.env.PROCESS_ROLE = 'web';
process.env.SYNC_SCHEDULER_ENABLED = 'true';
const original = { query: pool.query, execute: pool.execute, getConnection: pool.getConnection };
const externalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('External network is blocked by this test.'); }) as typeof fetch;

const locks = new Set<string>();
const jobs: any[] = [];
const dates: string[] = [];
let schedulerLockWins = 0;
let insertCount = 0;
const connection: any = {
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  async query(sql: string) {
    const lockName = sql.includes('oportuna_sync_scheduler') ? 'oportuna_sync_scheduler' :
      sql.includes('oportuna_sync_job_create') ? 'oportuna_sync_job_create' : null;
    if (sql.includes('GET_LOCK') && lockName) {
      if (locks.has(lockName)) return [[{ acquired: 0 }]];
      locks.add(lockName);
      if (lockName === 'oportuna_sync_scheduler') schedulerLockWins++;
      return [[{ acquired: 1 }]];
    }
    if (sql.includes('RELEASE_LOCK')) {
      if (lockName) locks.delete(lockName);
      else { locks.delete('oportuna_sync_scheduler'); locks.delete('oportuna_sync_job_create'); }
      return [[{ released: 1 }]];
    }
    if (sql.includes('FOR UPDATE')) return [jobs.filter(job => ['queued','running','paused'].includes(job.estado)).map(job => ({ id: job.id }))];
    throw new Error(`Unexpected connection query: ${sql}`);
  },
  async execute(sql: string, values: any[] = []) {
    if (sql.includes('INSERT INTO sync_jobs')) {
      insertCount++;
      const job = { id: insertCount, tipo: values[0], dateFrom: values[1], dateTo: values[2], estado: 'queued', active_refresh_status: values[3], total_dias: values[4] };
      jobs.push(job);
      return [{ insertId: job.id }];
    }
    if (sql.includes('INSERT INTO sync_job_days')) { dates.push(String(values[1])); return [{ affectedRows: 1 }]; }
    throw new Error(`Unexpected connection execute: ${sql}`);
  },
};

(pool as any).getConnection = async () => connection;
(pool as any).execute = async () => { throw new Error('Unexpected pool write.'); };
(pool as any).query = async (sql: string) => {
  if (sql.includes("WHERE estado IN ('queued','running','paused') LIMIT 1")) return [jobs.filter(job => ['queued','running','paused'].includes(job.estado)).map(job => ({ id: job.id }))];
  if (sql.includes("estado IN ('failed','completed_with_errors')")) return [[]];
  if (sql.includes("MAX(fecha),'%Y-%m-%d') lastDate")) return [[{ lastDate: '2026-11-02' }]];
  if (sql.includes("source='active_refresh'")) return [[{ lastDate: null }]];
  throw new Error(`Unexpected pool query: ${sql}`);
};

try {
  const { runSchedulerTickForTest } = await import('../src/syncService.js');
  const now = new Date('2026-11-08T11:00:00.000Z');
  await Promise.all([runSchedulerTickForTest(now), runSchedulerTickForTest(now)]);
  assert.equal(schedulerLockWins, 1, 'only one simultaneous scheduler acquires the MySQL named lock');
  assert.equal(insertCount, 1, 'only one active job is created');
  assert.deepEqual(dates, ['2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']);
  assert.equal(jobs[0].active_refresh_status, 'pending');
  assert.equal(locks.size, 0, 'all named locks are released');
  console.log('PASS simulated scheduler concurrency: two instances produce one bounded catch-up job, six pending dates and one active refresh; no external request.');
} finally {
  globalThis.fetch = externalFetch;
  Object.assign(pool, original);
  delete process.env.SYNC_SCHEDULER_ENABLED;
}
