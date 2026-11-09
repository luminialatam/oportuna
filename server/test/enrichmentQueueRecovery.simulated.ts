import assert from 'node:assert/strict';
import pool from '../src/db.js';

const originalQuery = pool.query;
const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;
const originalFetch = globalThis.fetch;
const originalEnv = {
  APP_ENV: process.env.APP_ENV,
  NODE_ENV: process.env.NODE_ENV,
  PROCESS_ROLE: process.env.PROCESS_ROLE,
  ENRICHMENT_WORKER_ENABLED: process.env.ENRICHMENT_WORKER_ENABLED,
};
const updates: string[] = [];
let lockReleased = false;
let externalCalls = 0;
const connection = {
  query: async (sql: string) => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], undefined] as any;
    if (sql.includes('RELEASE_LOCK')) { lockReleased = true; return [[{ released: 1 }], undefined] as any; }
    throw new Error(`Unexpected lock query: ${sql}`);
  },
  release: () => undefined,
};

process.env.APP_ENV = 'development';
process.env.NODE_ENV = 'development';
process.env.PROCESS_ROLE = 'all';
process.env.ENRICHMENT_WORKER_ENABLED = 'false';
(pool as any).getConnection = async () => connection;
(pool as any).query = async (sql: string) => {
  assert.match(sql, /JSON_CONTAINS_PATH/);
  return [[], undefined];
};
(pool as any).execute = async (sql: string) => { updates.push(sql); return [{ affectedRows: 1 }, undefined]; };
globalThis.fetch = (async () => { externalCalls++; throw new Error('Queue recovery simulation must not call external services.'); }) as typeof fetch;

try {
  const { recoverEnrichmentQueue } = await import('../src/listingEnrichment.js');
  await recoverEnrichmentQueue();
  assert.equal(updates.length, 2, 'recovery resets in-flight detail rows and reconciles in-flight pilot items');
  assert.match(updates[0], /UPDATE licitacion_enrichment SET estado='pending' WHERE estado='running'/);
  assert.match(updates[1], /UPDATE licitacion_enrichment_pilot_items pi\s+JOIN licitacion_enrichment e/);
  assert.match(updates[1], /WHEN 'completed' THEN 'completed'[\s\S]*WHEN 'empty' THEN 'empty'[\s\S]*WHEN 'failed' THEN 'failed'[\s\S]*ELSE 'queued'/);
  assert.match(updates[1], /WHERE pi\.estado='running'/);
  assert.equal(lockReleased, true, 'the shared worker lock must always be released');
  assert.equal(externalCalls, 0, 'recovery does not start a worker while workers are disabled');
  console.log('PASS interrupted enrichment jobs recover to queued state and preserve already committed results without external calls.');
} finally {
  (pool as any).query = originalQuery;
  (pool as any).execute = originalExecute;
  (pool as any).getConnection = originalGetConnection;
  globalThis.fetch = originalFetch;
  for (const [key,value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
