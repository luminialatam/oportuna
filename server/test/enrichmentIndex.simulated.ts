import assert from 'node:assert/strict';
import pool from '../src/db.js';

const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;
const originalFetch = globalThis.fetch;
const storedItems = new Map<string, Record<string, unknown>>();
let externalCalls = 0;
let commits = 0;

const connection = {
  beginTransaction: async () => undefined,
  commit: async () => { commits++; },
  rollback: async () => { throw new Error('Unexpected rollback'); },
  release: () => undefined,
  query: async (sql: string) => {
    assert.match(sql, /SELECT COUNT\(\*\) total FROM licitacion_items/);
    return [[{ total: storedItems.size }], undefined] as any;
  },
  execute: async (sql: string, values: any[] = []) => {
    if (sql.includes('INSERT INTO licitacion_items')) {
      const key = `${values[0]}#${values[1]}`;
      storedItems.set(key, { code: values[0], index: values[1], name: values[2] });
      return [{ affectedRows: 1 }, undefined] as any;
    }
    assert.ok(sql.includes('UPDATE licitaciones') || sql.includes('UPDATE licitacion_enrichment'));
    return [{ affectedRows: 1 }, undefined] as any;
  },
};

(pool as any).execute = async (sql: string) => {
  assert.match(sql, /INSERT IGNORE INTO licitacion_enrichment/);
  return [{ affectedRows: 0 }, undefined];
};
(pool as any).getConnection = async () => connection;
globalThis.fetch = (async () => { externalCalls++; throw new Error('Simulated indexing must not call external services.'); }) as typeof fetch;

try {
  const { indexOfficialDetail } = await import('../src/listingEnrichment.js');
  const simulatedApiDetail = {
    CodigoExterno: 'SIM-IDEMPOTENT', Nombre: 'Compra de dos equipos', CodigoEstado: 5,
    FechaCierre: '2026-12-01T12:00:00', MontoEstimado: 1200, Moneda: 'CLP',
    Comprador: { NombreOrganismo: 'Organismo simulado' },
    Items: { Listado: [
      { NombreProducto: 'Equipo A', Descripcion: 'Primera partida', Cantidad: 2, UnidadMedida: 'Unidad' },
      { NombreProducto: 'Equipo B', Descripcion: 'Segunda partida', Cantidad: 1, UnidadMedida: 'Unidad' },
    ] },
  };
  await indexOfficialDetail('SIM-IDEMPOTENT', simulatedApiDetail);
  await indexOfficialDetail('SIM-IDEMPOTENT', simulatedApiDetail);
  assert.equal(storedItems.size, 2, 're-indexing the same response must not duplicate item keys');
  assert.equal(commits, 2, 'each idempotent indexing operation commits cleanly');
  assert.equal(externalCalls, 0, 'the API response is simulated locally');
  console.log('PASS simulated official detail indexing is idempotent, deduplicates item indexes and makes no external calls.');
} finally {
  (pool as any).execute = originalExecute;
  (pool as any).getConnection = originalGetConnection;
  globalThis.fetch = originalFetch;
}
