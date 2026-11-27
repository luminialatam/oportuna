import assert from 'node:assert/strict';
import { offerDraftSchema } from '../src/offerDraftValidation.js';
import { suggestCatalogMatches } from '../../src/offerCatalogMatching.js';

const legacyDraft = {
  quoteName: 'Oferta de prueba', details: '', responsible: '', deadline: '', declarationReviewed: false,
  items: { bomba: { enabled: true, unitPrice: '100000', specification: 'Acero inoxidable', comment: '' } },
  documents: [],
};
const legacyParsed = offerDraftSchema.parse(legacyDraft);
assert.equal(legacyParsed.minimumMarginPercent, '');
assert.equal(legacyParsed.items.bomba.directUnitCost, '');
assert.equal(legacyParsed.items.bomba.catalogProductId, '');
assert.equal(legacyParsed.documents.length, 0);

const currentParsed = offerDraftSchema.parse({
  ...legacyDraft,
  minimumMarginPercent: '25.5',
  items: { bomba: { ...legacyDraft.items.bomba, directUnitCost: '70000' } },
});
assert.equal(currentParsed.minimumMarginPercent, '25.5');
assert.equal(currentParsed.items.bomba.directUnitCost, '70000');

const reviewedDraft = offerDraftSchema.parse({ ...legacyDraft, documents: [{ name: 'Bases', url: 'https://example.test/bases.pdf', requirement: 'Especificaciones', reviewStatus: 'covered', reviewNotes: 'Revisado manualmente' }] });
assert.equal(reviewedDraft.documents[0].reviewStatus, 'covered');
assert.equal(offerDraftSchema.safeParse({ ...legacyDraft, documents: [{ name: 'Bases', url: '', requirement: '', reviewStatus: 'invented' }] }).success, false);
const analyzedDraft = offerDraftSchema.parse({ ...legacyDraft, documents: [{
  name: 'Bases locales.pdf', url: '', requirement: '', reviewStatus: 'pending', reviewNotes: '', sourceKind: 'uploaded',
  analysisStatus: 'completed', analysisAt: '2026-11-27T12:00:00.000Z', analysisProvider: 'groq', analysisPartial: false,
  analysisWarnings: [], analysisOmittedUnverifiable: 1,
  analysisFindings: [{ id: 'finding-1', kind: 'deadline', title: 'Cierre de ofertas', extractedText: 'Hasta el 15 de diciembre de 2026', interpretation: 'Fecha mencionada en el documento.', sourceLocation: 'Página 1', sourceQuote: 'Hasta el 15 de diciembre de 2026', dueDate: '2026-12-15', reviewStatus: 'pending', correction: '', relatedItemCode: '', relatedDocumentName: '' }],
}] });
assert.equal(analyzedDraft.documents[0].analysisFindings?.[0].reviewStatus, 'pending');
assert.equal(offerDraftSchema.safeParse({ ...legacyDraft, documents: [{ ...analyzedDraft.documents[0], analysisFindings: [{ ...analyzedDraft.documents[0].analysisFindings![0], reviewStatus: 'approved' }] }] }).success, false);

assert.equal(offerDraftSchema.safeParse({ ...legacyDraft, minimumMarginPercent: '101' }).success, false);
assert.equal(offerDraftSchema.safeParse({ ...legacyDraft, items: { bomba: { ...legacyDraft.items.bomba, directUnitCost: '-1' } } }).success, false);

const catalog = [
  { id: 1, nombre: 'Impresión de pendones', categoria: 'Gráfica', descripcion: 'PVC con terminación', palabrasClave: ['impresión gran formato'], sinonimos: [], terminosRelacionados: [], aplicaciones: [], activo: true },
  { id: 2, nombre: 'Mantención de ascensores', categoria: 'Servicios', descripcion: '', palabrasClave: [], sinonimos: [], terminosRelacionados: [], aplicaciones: [], activo: true },
  { id: 3, nombre: 'Impresión de pendones', categoria: 'Gráfica', descripcion: '', palabrasClave: [], sinonimos: [], terminosRelacionados: [], aplicaciones: [], activo: false },
];
const matches = suggestCatalogMatches({ name: 'Servicio de confección de pendones', description: 'Impresión en PVC', category: 'Gráfica' }, catalog);
assert.equal(matches.length, 1);
assert.equal(matches[0].item.id, 1);
assert.ok(matches[0].terms.includes('pendones'));
assert.ok(matches[0].partEvidence.some(evidence => evidence.source === 'nombre de partida' && evidence.term === 'pendones'));
assert.ok(matches[0].evidence.some(evidence => evidence.source === 'categoría' && evidence.text === 'Gráfica'));
assert.equal(suggestCatalogMatches({ name: 'Mantención de instalaciones eléctricas', description: '', category: '' }, catalog).length, 0);

process.stdout.write('offerDraftValidation.unit: ok\n');
