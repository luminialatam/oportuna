import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches } from '../src/companyService.js';
import { hasProfileKeywordEvidence, profileKeywordEvidence } from '../src/commercialMatching.js';
import { preserveMatchOrder } from '../src/opportunityFeedService.js';

const originalQuery = pool.query;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('Profile keyword matching must remain local.'); }) as typeof fetch;
const keywords = Array.from({ length: 68 }, (_, index) => `criterio comercial ${index + 1}`);
keywords.push('convertidor de voltaje trifásico', 'molino coloidal trifásico');
const rows = [
  { id: 1, codigo_externo: 'SIM-PROFILE-TAIL', nombre: 'Adquisición de convertidor de voltaje trifásico', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 2, codigo_externo: 'SIM-PROFILE-SPLIT', nombre: 'Adquisición de molino para pequeña planta', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Organismo de prueba', monto_estimado: null, moneda: null, region: 'Región Metropolitana', official_description: 'El proceso requiere un equipo coloidal para alimentos.', item_text: 'Equipo trifásico industrial' },
  { id: 3, codigo_externo: 'SIM-PROFILE-UNRELATED', nombre: 'Compra de papel para oficina', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 4, codigo_externo: 'SIM-PROFILE-EXCLUDED', nombre: 'Adquisición de molino coloidal para minería', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: 'Equipo trifásico' },
];

(pool as any).query = async (sql: string, values: unknown[] = []): Promise<[any[], unknown]> => {
  if (sql.includes('FROM commercial_profiles')) {
    const companyId = Number(values[0]);
    return [[{ actividad: '', rubros: '[]', regiones: '[]', palabras_clave: JSON.stringify(companyId === 77 ? keywords : ['prensa expeller']), terminos_excluidos: JSON.stringify(companyId === 77 ? ['minería'] : []), updated_at: '2026-11-27' }], undefined];
  }
  if (sql.includes('FROM company_search_preferences')) return [[{ estados: '[5]', regiones: '["Región Metropolitana"]', updated_at: '2026-11-27' }], undefined];
  if (sql.includes('FROM company_products')) return [[], undefined];
  if (sql.includes('MAX(last_synced_at)')) return [[{ version: '2026-11-27' }], undefined];
  if (sql.includes('MAX(updated_at) version FROM company_opportunity_tracking')) return [[{ version: null }], undefined];
  if (sql.includes('SELECT COUNT(*) total FROM licitaciones')) return [[{ total: rows.length }], undefined];
  if (sql.includes('SELECT COUNT(*) total FROM company_opportunity_tracking')) return [[{ total: 0 }], undefined];
  if (sql.includes('FROM sync_runs WHERE estado=\'completada\'')) return [[{ finishedAt: null, checkedDate: null }], undefined];
  if (sql.includes('FROM (SELECT l.id FROM licitaciones l')) {
    const cursor = Number(values[values.length - 2] ?? 0);
    return [rows.filter(row => row.id > cursor).slice(0, 250), undefined];
  }
  throw new Error(`Unexpected SQL in profile keyword simulation: ${sql.slice(0, 120)}`);
};

try {
  assert.deepEqual(
    preserveMatchOrder([{ codigo_externo: 'A' }, { codigo_externo: 'B' }, { codigo_externo: 'C' }, { codigo_externo: 'A' }], new Set(['C', 'A'])).map(item => item.codigo_externo),
    ['A', 'C'],
    'the feed must keep the matching engine order and avoid duplicate listing codes when combining weekly cohorts',
  );
  clearCompanyMatchCache();
  const context = { userId: 7, role: 'admin' as const, platformRole: 'admin' as const, companyId: 77 };
  const result = await runWithCompanyContext(context, () => getCompanyMatches({ includeAllItems: true }));
  assert.equal(result.matchingBasis, 'profile_keywords');
  assert.equal(result.profileKeywordCount, 70);
  assert.equal(result.activeProductCount, 0);
  assert.equal(result.candidatesEvaluated, rows.length);
  assert.equal(result.total, 2, 'profile phrases with evidence distributed across fields remain discoverable without weakening full-phrase evidence');
  assert.equal(result.items[0].codigo_externo, 'SIM-PROFILE-TAIL');
  assert.equal(result.items[0].level, 'high');
  const splitMatch = result.items.find((item: any) => item.codigo_externo === 'SIM-PROFILE-SPLIT');
  assert.ok(splitMatch, 'the phrase should match when concrete terms are distributed across all official fields');
  assert.equal(splitMatch.level, 'medium', 'distributed partial field evidence remains medium, not high');
  assert.deepEqual(splitMatch.evidence.map((entry: any) => entry.source), ['título', 'descripción oficial', 'partidas indexadas']);
  assert.equal(splitMatch.matchKind, 'catalog_context', 'split keyword evidence is described as contextual rather than an exact phrase');
  assert.match(splitMatch.explanation, /términos del catálogo/);
  assert.ok(splitMatch.matchedTerms.includes('molino'), 'literal matched terms are surfaced separately from normalized query phrases');
  assert.ok(splitMatch.matchedTerms.includes('coloidal'));
  assert.ok(splitMatch.matchedTerms.includes('trifásico'));
  assert.equal(splitMatch.preferredRegion, 'Región Metropolitana', 'a matching region preference is exposed in its configured label');
  assert.equal(splitMatch.exclusionsChecked, true, 'recommendations indicate that profile and selected-product exclusions were applied');
  assert.equal(splitMatch.exclusionTermsChecked, 1, 'the result reports the number of configured exclusions checked without exposing private terms');
  assert.ok(splitMatch.matchReasons.some((reason: string) => reason.includes('Organismo comprador informado')));
  assert.ok(splitMatch.evidence.some((entry: any) => entry.text.includes('molino')));
  assert.ok(splitMatch.evidence.some((entry: any) => entry.text.includes('coloidal')));
  assert.ok(splitMatch.evidence.some((entry: any) => entry.text.includes('trifásico')));
  assert.ok(!result.items.some((item: any) => item.codigo_externo === 'SIM-PROFILE-EXCLUDED'), 'profile exclusions must win over phrase matches');
  assert.equal(result.total, result.high + result.medium + result.exploratory);
  assert.equal(hasProfileKeywordEvidence('molino coloidal trifásico', 'molino', 'equipo coloidal', 'equipo trifásico'), true);
  assert.equal(profileKeywordEvidence('molino coloidal trifásico', 'molino', 'equipo para alimentos', 'equipo industrial'), null, 'missing a phrase term remains a non-match');
  clearCompanyMatchCache();
  const zero = await runWithCompanyContext({ ...context, companyId: 78 }, () => getCompanyMatches({ includeAllItems: true }));
  assert.equal(zero.total, 0, 'valid candidates with no matching profile evidence must remain an explicit zero-result case');
  assert.equal(zero.candidatesEvaluated, rows.length);
  console.log('PASS profile fallback combines complete phrase evidence across fields, preserves exclusions, exposes literal excerpts, and keeps unrelated/no-evidence cases at zero.');
} finally {
  (pool as any).query = originalQuery;
  globalThis.fetch = originalFetch;
  await pool.end();
}
