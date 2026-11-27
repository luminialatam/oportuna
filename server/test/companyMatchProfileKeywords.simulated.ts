import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches } from '../src/companyService.js';

const originalQuery = pool.query;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('Profile keyword matching must remain local.'); }) as typeof fetch;
const keywords = Array.from({ length: 69 }, (_, index) => `criterio comercial ${index + 1}`);
keywords.push('convertidor de voltaje trifásico');
const rows = [
  { id: 1, codigo_externo: 'SIM-PROFILE-TAIL', nombre: 'Adquisición de convertidor de voltaje trifásico', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 2, codigo_externo: 'SIM-PROFILE-UNRELATED', nombre: 'Compra de papel para oficina', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
];

(pool as any).query = async (sql: string, values: unknown[] = []): Promise<[any[], unknown]> => {
  if (sql.includes('FROM commercial_profiles')) return [[{ actividad: '', rubros: '[]', regiones: '[]', palabras_clave: JSON.stringify(keywords), terminos_excluidos: '[]', updated_at: '2026-11-27' }], undefined];
  if (sql.includes('FROM company_search_preferences')) return [[{ estados: '[5]', regiones: '[]', updated_at: '2026-11-27' }], undefined];
  if (sql.includes('FROM company_products')) return [[], undefined];
  if (sql.includes('MAX(last_synced_at)')) return [[{ version: '2026-11-27' }], undefined];
  if (sql.includes('MAX(updated_at) version FROM company_opportunity_tracking')) return [[{ version: null }], undefined];
  if (sql.includes('SELECT COUNT(*) total FROM licitaciones')) return [[{ total: 2 }], undefined];
  if (sql.includes('SELECT COUNT(*) total FROM company_opportunity_tracking')) return [[{ total: 0 }], undefined];
  if (sql.includes('FROM sync_runs WHERE estado=\'completada\'')) return [[{ finishedAt: null, checkedDate: null }], undefined];
  if (sql.includes('FROM (SELECT l.id FROM licitaciones l')) {
    const cursor = Number(values[values.length - 2] ?? 0);
    return [rows.filter(row => row.id > cursor).slice(0, 250), undefined];
  }
  throw new Error(`Unexpected SQL in profile keyword simulation: ${sql.slice(0, 120)}`);
};

try {
  clearCompanyMatchCache();
  const context = { userId: 7, role: 'admin' as const, platformRole: 'admin' as const, companyId: 77 };
  const result = await runWithCompanyContext(context, () => getCompanyMatches({ includeAllItems: true }));
  assert.equal(result.matchingBasis, 'profile_keywords');
  assert.equal(result.profileKeywordCount, 70);
  assert.equal(result.candidatesEvaluated, rows.length);
  assert.equal(result.total, 1, 'a concrete product phrase at the end of a long profile remains discoverable');
  assert.equal(result.items[0].codigo_externo, 'SIM-PROFILE-TAIL');
  assert.equal(result.items[0].level, 'high');
  assert.equal(result.total, result.high + result.medium + result.exploratory);
  console.log('PASS profile keyword fallback evaluates the complete local index, finds evidence from the last saved keyword and returns no unrelated listing.');
} finally {
  (pool as any).query = originalQuery;
  globalThis.fetch = originalFetch;
  await pool.end();
}
