import assert from 'node:assert/strict';
import { rankEnrichmentCandidates, type PreviewProduct, type PreviewListingRow } from '../src/enrichmentPreview.js';

const now = new Date('2026-11-02T12:00:00Z').getTime();
const catalog: PreviewProduct[] = [{ nombre: 'Horno eléctrico combinado', activo: true, sinonimos: ['horno convector combinado'], aplicaciones: ['cocina institucional'], exclusiones: ['mantención'] }];
const rows: PreviewListingRow[] = [
  { code: 'A', title: 'Horno eléctrico combinado', organism: 'Hospital', closeAt: '2026-11-10T00:00:00Z', description: '', category: '', itemText: '', itemCount: 0, detailStatus: null, detailUpdatedAt: null },
  { code: 'B', title: 'Servicio de alimentación comunitaria', organism: null, closeAt: '2026-11-12T00:00:00Z', description: 'Programa de alimentación saludable.', category: '', itemText: '', itemCount: 0, detailStatus: null, detailUpdatedAt: null },
  { code: 'C', title: 'Equipos para cocina institucional', organism: null, closeAt: '2026-11-13T00:00:00Z', description: 'Horno eléctrico combinado.', category: '', itemText: '', itemCount: 0, detailStatus: null, detailUpdatedAt: null },
  { code: 'D', title: 'Horno eléctrico combinado', organism: null, closeAt: '2026-10-30T00:00:00Z', description: '', category: '', itemText: '', itemCount: 0, detailStatus: null, detailUpdatedAt: null },
  { code: 'E', title: 'Horno eléctrico combinado', organism: null, closeAt: '2026-11-14T00:00:00Z', description: 'incluye mantención', category: '', itemText: '', itemCount: 0, detailStatus: null, detailUpdatedAt: null },
  { code: 'F', title: 'Horno eléctrico combinado', organism: null, closeAt: '2026-11-15T00:00:00Z', description: '', category: '', itemText: '', itemCount: 1, detailStatus: 'completed', detailUpdatedAt: '2026-11-01T00:00:00Z' },
  { code: 'G', title: 'Horno eléctrico combinado', organism: null, closeAt: '2026-11-16T00:00:00Z', description: '', category: '', itemText: '', itemCount: 0, detailStatus: 'empty', detailUpdatedAt: '2026-11-01T00:00:00Z' },
  { code: 'PLACE', title: 'Adquisición de molino coloidal para el Parque Los Molinos', organism: null, closeAt: '2026-11-17T00:00:00Z', description: '', category: '', itemText: '', itemCount: 0, detailStatus: null, detailUpdatedAt: null },
];
const result = rankEnrichmentCandidates(rows, catalog, [], now, 10);
assert.deepEqual(result.candidates.map(item => item.code), ['A', 'C']);
assert.equal(result.eligibleCandidates, 2);
assert.ok(result.candidates.every(item => ['high', 'medium'].includes(item.level)));
assert.ok(result.candidates[0].reason.includes('título'));
assert.ok(result.candidates[1].reason.includes('descripción oficial'));
const noActiveCatalog = rankEnrichmentCandidates(rows, [{ ...catalog[0], activo: false }], [], now);
assert.equal(noActiveCatalog.eligibleCandidates, 0);
const excluded = rankEnrichmentCandidates([rows[0]], catalog, ['horno'], now);
assert.equal(excluded.eligibleCandidates, 0);
const colloidal = rankEnrichmentCandidates([rows[7]], [{ nombre: 'Molinos coloidales', activo: true }], [], now);
assert.equal(colloidal.eligibleCandidates, 0, 'known place names must not become machinery matches');
const ovenCatalog = [{ nombre: 'Hornos industriales', activo: true, palabrasClave: ['horno industrial para alimentos'] }];
const incompleteOven = { ...rows[0], code: 'INCOMPLETE-OVEN', title: 'Adquisición de horno industrial', description: '', closeAt: '2026-11-18T00:00:00Z' };
const investigate = rankEnrichmentCandidates([incompleteOven], ovenCatalog, [], now);
assert.equal(investigate.candidates[0]?.selectionType, 'investigation');
assert.equal(investigate.candidates[0]?.level, 'exploratory');
assert.ok(investigate.candidates[0]?.reason.includes('Match sigue exploratorio'));
const pastryOven = rankEnrichmentCandidates([{ ...incompleteOven, code: 'PASTRIES', title: 'Adquisición pan y empanadas de horno' }], ovenCatalog, [], now);
assert.equal(pastryOven.eligibleCandidates, 0, 'a bakery goods purchase must not become an oven investigation candidate');
console.log('PASS preview uses specific title/description evidence, excludes generic-only, expired, enriched, place-name and explicitly excluded matches; inactive catalog yields no candidates.');
