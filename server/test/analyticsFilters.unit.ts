import assert from 'node:assert/strict';
import { buildAnalyticsWhere, defaultAnalyticsFilters, normalizeAnalyticsFilters } from '../src/analyticsFilters.js';

const now = new Date('2026-11-22T10:00:00.000Z');
const defaults = defaultAnalyticsFilters(now);
assert.deepEqual(defaults, { dateFrom: '2026-01-01', dateTo: '2026-11-22', modality: '', product: '', organism: '', region: '', state: '' });

const filtered = normalizeAnalyticsFilters({
  dateFrom: '2026-02-01', dateTo: '2026-02-28', modality: 'LE', product: 'selladora',
  organism: 'Municipalidad', region: 'Región de Valparaíso', state: '5',
}, now);
const query = buildAnalyticsWhere(filtered);
assert.equal(query.values.length, 7);
assert.deepEqual(query.values, ['2026-02-01 00:00:00','2026-02-28 00:00:00','LE','%selladora%','%Municipalidad%','Región de Valparaíso',5]);
assert.match(query.sql, /COALESCE\(l\.fecha_publicacion,l\.last_synced_at\)/);
assert.match(query.sql, /EXISTS \(SELECT 1 FROM licitacion_items/);
assert.match(query.sql, /JSON_EXTRACT\(l\.payload_json/);
assert.doesNotMatch(query.sql, /selladora|Municipalidad|Valparaíso/);

assert.throws(() => normalizeAnalyticsFilters({ dateFrom: '2026-02-30', dateTo: '2026-03-01' }, now), /período/);
assert.throws(() => normalizeAnalyticsFilters({ dateFrom: '2026-04-01', dateTo: '2026-03-31' }, now), /período/);
assert.throws(() => normalizeAnalyticsFilters({ state: '5 OR 1=1' }, now), /estado/);

console.log('analytics filters unit: PASS');
