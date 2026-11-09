import assert from 'node:assert/strict';
import pool from '../src/db.js';

process.env.PROCESS_ROLE = 'web';
process.env.MERCADOPUBLICO_TICKET = 'simulated-only';
process.env.MERCADOPUBLICO_MAX_RETRIES = '2';
process.env.MERCADOPUBLICO_MIN_INTERVAL_MS = '2000';
process.env.SYNC_SCHEDULER_ENABLED = 'false';
const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const original = { query: pool.query, execute: pool.execute, getConnection: pool.getConnection };
let requests = 0;
let state = 'queued';
let dayState = 'pending';
let refreshState = 'pending';
let runId = 0;
const namedLocks = new Set<string>();

const connection: any = {
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  async query(sql: string) {
    const name = sql.includes('oportuna_sync_job_create') ? 'create' : sql.includes('oportuna_sync_worker') ? 'worker' : sql.includes('oportuna_mercado_publico_request') ? 'api' : null;
    if (sql.includes('GET_LOCK') && name) { if (namedLocks.has(name)) return [[{ acquired: 0 }]]; namedLocks.add(name); return [[{ acquired: 1 }]]; }
    if (sql.includes('RELEASE_LOCK') && name) { namedLocks.delete(name); return [[{ released: 1 }]]; }
    if (sql.includes('estado IN') && sql.includes('FOR UPDATE')) return [[]];
    throw new Error(`Unexpected connection query: ${sql}`);
  },
  async execute(sql: string, values: any[] = []) {
    if (sql.includes('INSERT INTO sync_jobs')) return [{ insertId: 73 }];
    if (sql.includes('INSERT INTO sync_job_days')) return [{ affectedRows: 1 }];
    return execute(sql, values);
  },
};
async function execute(sql: string, values: any[] = []): Promise<any> {
  if (sql.includes('INSERT INTO sync_runs')) return [{ insertId: ++runId }];
  if (sql.includes("UPDATE sync_job_days SET estado='in_progress'")) { dayState = 'in_progress'; return [{ affectedRows: 1 }]; }
  if (sql.includes("UPDATE sync_job_days SET estado='failed'")) { dayState = 'failed'; return [{ affectedRows: 1 }]; }
  if (sql.includes("UPDATE sync_runs SET estado='fallida'")) return [{ affectedRows: 1 }];
  if (sql.includes("UPDATE sync_jobs SET estado='failed'")) { state = 'failed'; return [{ affectedRows: 1 }]; }
  if (sql.includes("UPDATE sync_jobs SET estado='running'")) { state = 'running'; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_jobs SET dias_completados=')) return [{ affectedRows: 1 }];
  throw new Error(`Unexpected pool execute: ${sql} ${JSON.stringify(values)}`);
}

(pool as any).getConnection = async () => connection;
(pool as any).execute = execute;
(pool as any).query = async (sql: string) => {
  if (sql.includes('SELECT * FROM sync_jobs WHERE id=?')) return [[state === 'queued' || state === 'running' ? { id: 73, tipo: 'diaria', estado: state, active_refresh_status: refreshState, total_dias: 1 } : undefined].filter(Boolean)];
  if (sql.includes('SELECT DATE_FORMAT(fecha')) return [[dayState === 'pending' ? { fecha: '2026-11-07' } : undefined].filter(Boolean)];
  if (sql.includes('SELECT COUNT(*) total')) return [[{ total: 1, errors: dayState === 'failed' ? 1 : 0 }]];
  throw new Error(`Unexpected pool query: ${sql}`);
};
globalThis.setTimeout = ((handler: (...args: any[]) => void, _delay?: number, ...args: any[]) => originalTimeout(handler, 0, ...args)) as typeof setTimeout;
globalThis.fetch = (async () => { requests++; return new Response('unavailable', { status: 503 }); }) as typeof fetch;

try {
  const { startJob } = await import('../src/syncService.js');
  await startJob('2026-11-07', '2026-11-07', 'diaria', true);
  for (let i = 0; i < 300 && state !== 'failed'; i++) await new Promise(resolve => originalTimeout(resolve, 5));
  assert.equal(state, 'failed');
  assert.equal(dayState, 'failed');
  assert.equal(refreshState, 'pending', 'active refresh is not attempted after a date exhausts its retries');
  assert.equal(requests, 3, 'initial attempt plus the two configured retries');
  assert.equal(namedLocks.size, 0, 'worker and HTTP locks are released after failure');
  console.log('PASS simulated HTTP failure: stops after configured retries, marks the date/job failed, skips active refresh and releases locks; no external request.');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalTimeout;
  Object.assign(pool, original);
}
