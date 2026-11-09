import assert from 'node:assert/strict';
import pool from '../src/db.js';

const originalQuery = pool.query;
const originalExecute = pool.execute;
const originalFetch = globalThis.fetch;
const now = new Date(Date.now() + 7 * 86_400_000).toISOString();
let candidateReads = 0;
let metricReads = 0;
let writes = 0;
let externalCalls = 0;
const row = {
  code: 'SIM-OVEN', title: 'Horno eléctrico combinado', organism: 'Hospital local', closeAt: now,
  description: 'Compra de horno eléctrico combinado.', category: '', itemText: '', itemCount: 0,
  detailStatus: null, detailUpdatedAt: null,
};
const rows = [row,
  { ...row, code: 'SIM-OVEN-UNKNOWN', description: '' },
  { ...row, code: 'SIM-OVEN-SERVICE', title: 'Servicio de mantención de horno eléctrico combinado', description: '' },
];
(pool as any).query = async (sql: string) => {
  if (sql.includes('FROM licitaciones l') && sql.includes('licitacion_enrichment_pilot_items')) {
    assert.match(sql,/NOT EXISTS \(SELECT 1 FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo\)/);
    assert.doesNotMatch(sql,/e\.estado IN \('completed','empty'\)/);
    candidateReads++; return [rows];
  }
  if (sql.includes('active_listings')) { metricReads++; return [[{ active_listings: 100, active_with_items: 20, coverage_percent: 20 }]]; }
  throw new Error(`Unexpected preview SELECT: ${sql}`);
};
(pool as any).execute = async () => { writes++; throw new Error('Preview must not write to MySQL.'); };
globalThis.fetch = (async () => { externalCalls++; throw new Error('Preview must not call external services.'); }) as typeof fetch;

try {
  const { previewEnrichmentCandidates } = await import('../src/listingEnrichment.js');
  const result = await previewEnrichmentCandidates([{ nombre: 'Horno eléctrico combinado', tiposComerciales: ['product_supply'], activo: true }]);
  assert.equal(result.eligibleCandidates, 2);
  assert.equal(result.candidates[0].code, 'SIM-OVEN');
  assert.equal(result.candidates[0].level, 'high');
  assert.equal(result.candidates[0].selectionType, 'commercial_evidence');
  assert.ok(result.candidates[0].informationAvailable.includes('Estado: publicada'));
  assert.ok(result.candidates[0].contractingTypes.includes('Compra o suministro'));
  const unknown = result.candidates.find(candidate => candidate.code === 'SIM-OVEN-UNKNOWN');
  assert.equal(unknown?.level, 'exploratory');
  assert.equal(unknown?.selectionType, 'investigation');
  assert.ok(unknown?.informationMissing.includes('Partidas y cantidades oficiales'));
  assert.equal(candidateReads, 1);
  assert.equal(metricReads, 1);
  assert.equal(writes, 0);
  assert.equal(externalCalls, 0);
  console.log('PASS simulated enrichment preview: local evidence only, max candidate flow is SELECT-only and makes no external calls.');
} finally {
  (pool as any).query = originalQuery;
  (pool as any).execute = originalExecute;
  globalThis.fetch = originalFetch;
}
