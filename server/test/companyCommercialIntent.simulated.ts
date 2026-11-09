import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches } from '../src/companyService.js';

const originalQuery = pool.query;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('Commercial intent simulation must not use external APIs.'); }) as typeof fetch;
const products = [
  { id: 1, nombre: 'Mantención de edificios', categoria: 'Servicio de mantención', descripcion: '', palabras_clave: '["mantención edificio institucional"]', sinonimos: '["reparación de inmueble"]', terminos_relacionados: '[]', aplicaciones: '[]', exclusiones: '[]', tipos_comerciales: '["service","maintenance_repair"]' },
  { id: 2, nombre: 'Lavavajillas industriales', categoria: '', descripcion: '', palabras_clave: '["lavavajillas industrial"]', sinonimos: '[]', terminos_relacionados: '[]', aplicaciones: '[]', exclusiones: '[]', tipos_comerciales: '["product_supply"]' },
  { id: 3, nombre: 'Horno combinado', categoria: '', descripcion: '', palabras_clave: '[]', sinonimos: '[]', terminos_relacionados: '[]', aplicaciones: '[]', exclusiones: '[]', tipos_comerciales: '["product_supply"]' },
];
const rows = [
  { id: 1, codigo_externo: 'SIM-VEHICLE', nombre: 'Servicio de mantención preventiva de vehículos', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 2, codigo_externo: 'SIM-BUILDING', nombre: 'Servicio de mantención preventiva de edificios institucionales', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 3, codigo_externo: 'SIM-DISH-SERVICE', nombre: 'Servicio de mantención de lavavajillas industriales', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 4, codigo_externo: 'SIM-DISH-COMBINED', nombre: 'Suministro e instalación de lavavajillas industrial', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
  { id: 5, codigo_externo: 'SIM-OVEN-BARE', nombre: 'Horno combinado', codigo_estado: 5, fecha_cierre: '2026-12-01', organismo: 'Test', monto_estimado: null, moneda: null, region: null, official_description: '', item_text: '' },
];
(pool as any).query = async (sql: string, values: unknown[] = []): Promise<[any[], unknown]> => {
  if (sql.includes('FROM commercial_profiles')) return [[{ actividad: '', rubros: '[]', regiones: '[]', palabras_clave: '[]', terminos_excluidos: '[]', updated_at: '2026-11-02' }], undefined];
  if (sql.includes('FROM company_search_preferences')) return [[{ estados: '[5]', regiones: '[]', updated_at: '2026-11-02' }], undefined];
  if (sql.includes('FROM company_products')) return [Number(values[0]) === 1 ? [] : products, undefined];
  if (sql.includes('MAX(last_synced_at)')) return [[{ version: '2026-11-02' }], undefined];
  if (sql.includes('FROM (SELECT l.id FROM licitaciones l')) {
    const cursor = Number(values[values.length - 2]);
    return [rows.filter(row => row.id > cursor).slice(0, 250), undefined];
  }
  throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
};

try {
  const context = { userId: 9, companyId: 77, role: 'admin' as const, platformRole: 'admin' as const };
  clearCompanyMatchCache();
  const result = await runWithCompanyContext(context, () => getCompanyMatches({ includeAllItems: true }));
  const byCode = new Map(result.items.map((item: any) => [item.codigo_externo, item]));
  assert.equal(byCode.has('SIM-VEHICLE'), false, 'vehicle maintenance must not match building maintenance');
  assert.equal(byCode.has('SIM-DISH-SERVICE'), false, 'maintenance work must not match a supply-only appliance offer');
  assert.equal(byCode.has('SIM-BUILDING'), true, 'the valid building maintenance opportunity remains');
  assert.equal(byCode.has('SIM-DISH-COMBINED'), true, 'a compatible supply plus installation opportunity remains');
  assert.equal(byCode.has('SIM-OVEN-BARE'), true, 'a bare title remains visible as exploratory, not confirmed');
  assert.equal((byCode.get('SIM-OVEN-BARE') as any).level, 'exploratory');
  assert.equal((byCode.get('SIM-OVEN-BARE') as any).score, 94, 'the score remains unchanged when evidence modality is unknown');
  assert.ok((byCode.get('SIM-DISH-COMBINED') as any).contractingTypes.includes('Compra o suministro'));
  assert.ok((byCode.get('SIM-DISH-COMBINED') as any).contractingTypes.includes('Instalación y puesta en marcha'));
  const isolated = await runWithCompanyContext({ ...context, companyId: 1 }, () => getCompanyMatches());
  assert.equal(isolated.configured, false, 'company isolation remains intact');
  console.log('PASS commercial intent gating, explicit domain conflict, combined supply/installation, unclassified exploratory behavior and company isolation.');
} finally {
  (pool as any).query = originalQuery;
  globalThis.fetch = originalFetch;
}
