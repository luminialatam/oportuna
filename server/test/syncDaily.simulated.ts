import assert from 'node:assert/strict';
import pool from '../src/db.js';

process.env.PROCESS_ROLE = 'web';
process.env.MERCADOPUBLICO_TICKET = 'simulated-ticket';
process.env.MERCADOPUBLICO_MIN_INTERVAL_MS = '2000';

const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
const originalPool = { query: pool.query, execute: pool.execute, getConnection: pool.getConnection };
const dates = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
const existingItems = [{ code: 'HIST-KEEP', name: 'Partida histórica que debe conservarse' }];
const listings = new Map<string, any>([['HIST-KEEP', { code: 'HIST-KEEP', name: 'Nombre anterior', state: 5, closeAt: null, payload: { old: true } }]]);
const days = new Map<string, { state: string; received: number; inserted: number; updated: number }>();
const job: any = { id: 41, tipo: 'diaria', estado: 'queued', active_refresh_status: 'pending', dias_completados: 0, dias_fallidos: 0, total_recibidos: 0, total_insertados: 0, total_actualizados: 0, total_dias: dates.length };
let runId = 0;
let apiCalls = 0;
let itemRows = existingItems.slice();

const connection: any = {
  async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  async query(sql: string) {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.includes('sync_jobs') && sql.includes('estado IN') && sql.includes('LIMIT 1 FOR UPDATE')) return [[]];
    throw new Error(`Unexpected connection query: ${sql}`);
  },
  async execute(sql: string, values: any[] = []) { return execute(sql, values); },
};

async function execute(sql: string, values: any[] = []): Promise<any> {
  if (sql.includes('INSERT INTO sync_jobs')) { Object.assign(job, { tipo: values[0], estado: 'queued', active_refresh_status: values[3], total_dias: values[4] }); return [{ insertId: job.id }]; }
  if (sql.includes('INSERT INTO sync_job_days')) { days.set(String(values[1]), { state: 'pending', received: 0, inserted: 0, updated: 0 }); return [{ affectedRows: 1 }]; }
  if (sql.includes('INSERT INTO sync_runs')) return [{ insertId: ++runId }];
  if (sql.includes('INSERT INTO licitaciones')) {
    const [code, name, state, closeAt, publishAt, buyer, amount, currency, payload] = values;
    const previous = listings.get(code);
    listings.set(code, { code, name: name ?? previous?.name ?? null, state: state ?? previous?.state ?? null, closeAt: closeAt ?? previous?.closeAt ?? null, publishAt: publishAt ?? previous?.publishAt ?? null, buyer: buyer ?? previous?.buyer ?? null, amount: amount ?? previous?.amount ?? null, currency: currency ?? previous?.currency ?? null, payload: { ...(previous?.payload ?? {}), ...JSON.parse(payload) } });
    return [{ affectedRows: previous ? 2 : 1 }];
  }
  if (sql.includes('UPDATE sync_job_days SET estado=\'in_progress\'')) { days.get(String(values[1]))!.state = 'in_progress'; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_job_days SET estado=\'completed\'')) { const d = days.get(String(values[4]))!; Object.assign(d, { state: 'completed', received: values[0], inserted: values[1], updated: values[2] }); return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_job_days SET estado=\'failed\'')) { days.get(String(values[2]))!.state = 'failed'; return [{ affectedRows: 1 }]; }
  if (sql.includes("UPDATE sync_job_days SET estado='pending'") && sql.includes("estado='in_progress'")) { for (const d of days.values()) if (d.state === 'in_progress') d.state = 'pending'; return [{ affectedRows: 1 }]; }
  if (sql.includes("UPDATE sync_runs SET estado='fallida'") && sql.includes("estado='en_progreso'")) return [{ affectedRows: 0 }];
  if (sql.includes('UPDATE sync_jobs SET estado=CASE')) { if (job.estado === 'running') job.estado = 'queued'; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_runs SET estado=\'completada\'')) return [{ affectedRows: 1 }];
  if (sql.includes('UPDATE sync_runs SET estado=\'fallida\'')) return [{ affectedRows: 1 }];
  if (sql.includes('UPDATE sync_jobs SET active_refresh_status=\'completed\'')) { job.active_refresh_status = 'completed'; job.total_recibidos += values[0]; job.total_insertados += values[1]; job.total_actualizados += values[2]; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_jobs SET active_refresh_status=\'failed\'')) { job.active_refresh_status = 'failed'; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_jobs SET estado=\'running\'')) { job.estado = 'running'; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_jobs SET estado=?,finished_at')) { job.estado = values[0]; return [{ affectedRows: 1 }]; }
  if (sql.includes('UPDATE sync_jobs SET dias_completados=')) { job.dias_completados = [...days.values()].filter(d => d.state === 'completed').length; job.dias_fallidos = [...days.values()].filter(d => d.state === 'failed').length; job.total_recibidos = [...days.values()].reduce((n,d)=>n+d.received,0); job.total_insertados = [...days.values()].reduce((n,d)=>n+d.inserted,0); job.total_actualizados = [...days.values()].reduce((n,d)=>n+d.updated,0); return [{ affectedRows: 1 }]; }
  throw new Error(`Unexpected pool execute: ${sql}`);
}

(pool as any).getConnection = async () => connection;
(pool as any).execute = execute;
(pool as any).query = async (sql: string, values: any[] = []) => {
  if (sql.includes('SELECT * FROM sync_jobs WHERE id=?')) return [[['queued','running'].includes(job.estado) ? { ...job } : undefined].filter(Boolean)];
  if (sql.includes("SELECT * FROM sync_jobs WHERE estado IN ('queued','running')")) return [[['queued','running'].includes(job.estado) ? { ...job } : undefined].filter(Boolean)];
  if (sql.includes('SELECT DATE_FORMAT(fecha')) { const row = [...days].find(([,d]) => d.state === 'pending'); return [row ? [{ fecha: row[0] }] : []]; }
  if (sql.includes('SELECT COUNT(*) total')) return [[{ total: days.size, errors: [...days.values()].filter(d => d.state === 'failed').length }]];
  if (sql.includes('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
  if (sql.includes('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
  throw new Error(`Unexpected pool query: ${sql}`);
};

// Remove pacing waits in this isolated mock-only process. Fetch is hard-blocked below unless mocked.
(globalThis as any).setTimeout = (handler: (...args: any[]) => void, _ms?: number, ...args: any[]) => originalTimeout(handler, 0, ...args);
globalThis.fetch = (async (input: any) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.mercadopublico.cl') throw new Error('External network is blocked by this test.');
  apiCalls++;
  const code = url.searchParams.get('fecha') ? `DAY-${url.searchParams.get('fecha')}` : null;
  const rows = code
    ? [{ CodigoExterno: code, Nombre: `Licitación ${code}`, CodigoEstado: 5, FechaCierre: '2026-12-01T12:00:00' }, ...(url.searchParams.get('fecha') === '30102026' ? [{ CodigoExterno: 'HIST-KEEP', Nombre: 'Nombre oficial actualizado', CodigoEstado: 5 }] : [])]
    : [{ CodigoExterno: 'ACTIVE-NEW', Nombre: 'Activa nueva', CodigoEstado: 5 }, { CodigoExterno: 'HIST-KEEP', Nombre: 'Nombre actualizado en refresco', CodigoEstado: 6, FechaCierre: '2026-10-01T00:00:00' }];
  return new Response(JSON.stringify({ Licitaciones: { Listado: rows } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

try {
  const { startJob } = await import('../src/syncService.js');
  const jobId = await startJob('2026-10-30', '2026-11-02', 'diaria', true);
  assert.equal(jobId, 41);
  for (let i = 0; i < 200 && !['completed', 'completed_with_errors', 'failed'].includes(job.estado); i++) await new Promise(resolve => originalTimeout(resolve, 5));
  assert.equal(job.estado, 'completed');
  assert.equal(job.dias_completados, 4);
  assert.equal(job.active_refresh_status, 'completed');
  assert.equal(apiCalls, 5, 'four date calls plus one active refresh');
  assert.equal(new Set([...listings.keys()]).size, listings.size, 'upsert semantics keep unique listing codes');
  assert.equal(listings.size, 6, 'the same existing code returned by both date and active endpoints is still one unique row');
  assert.equal(listings.get('HIST-KEEP').state, 6, 'active refresh updates state');
  assert.ok(listings.has('DAY-30102026') && listings.has('DAY-02112026'));
  assert.deepEqual(itemRows, existingItems, 'daily sync does not delete or replace historical item rows');
  // Simulate a restart after three dates were complete and the fourth was left in progress.
  job.estado = 'running';
  days.get(dates[0])!.state = 'completed';
  days.get(dates[1])!.state = 'in_progress';
  days.get(dates[2])!.state = 'completed';
  days.get(dates[3])!.state = 'completed';
  process.env.PROCESS_ROLE = 'all';
  const { recoverJobs } = await import('../src/syncService.js');
  await recoverJobs();
  for (let i = 0; i < 200 && !['completed','completed_with_errors','failed'].includes(job.estado); i++) await new Promise(resolve => originalTimeout(resolve, 5));
  assert.equal(job.estado, 'completed');
  assert.equal(apiCalls, 6, 'restart reprocesses only the interrupted date, without repeating successful dates or active refresh');
  assert.ok(listings.has('DAY-31102026'));
  assert.equal(new Set([...listings.keys()]).size, listings.size);
  assert.deepEqual(itemRows, existingItems, 'recovery preserves historical item rows');
  console.log('PASS simulated daily sync/recovery: four dates, active refresh, status updates, idempotent upserts, one interrupted date resumed, completed dates skipped and historical item preservation.');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalTimeout;
  Object.assign(pool, originalPool);
}
