import assert from 'node:assert/strict';
import { buildCommercialDecision } from '../src/commercialDecision.js';

const common = {
  availability: { status: 'open', label: 'Publicada y dentro del plazo informado', isOpen: true },
  match: { score: 92, level: 'high', productName: 'Molino coloidal', matchedSources: ['título', 'partidas indexadas'], reason: 'Coincidencia con el catálogo.' },
  coverage: { missing: ['Monto estimado', 'Documentos y bases'] },
  buyer: 'I MUNICIPALIDAD DE VIÑA DEL MAR', amount: null, currency: null, itemCount: 2, documentsPresent: true,
};

const positive = buildCommercialDecision(common);
assert.equal(positive.label, 'Avanzar a evaluación económica');
assert.equal(positive.nextAction.tab, 'oferta');
assert.match(positive.evidence[0], /no es una probabilidad de adjudicación/);
assert.ok(positive.toConfirm.includes('Monto estimado'));
assert.match(positive.summary, /costos/);

const closed = buildCommercialDecision({ ...common, availability: { status: 'awarded', label: 'Adjudicada', isOpen: false } });
assert.equal(closed.label, 'Proceso adjudicado');
assert.equal(closed.nextAction.tab, 'resumen');

const unknownState = buildCommercialDecision({ ...common, availability: { status: 'unknown', label: 'Estado no verificado', isOpen: null } });
assert.equal(unknownState.label, 'Estado pendiente de validar');
assert.equal(unknownState.nextAction.tab, 'resumen');

const missingScope = buildCommercialDecision({ ...common, documentsPresent: false, itemCount: 0 });
assert.equal(missingScope.label, 'Validar alcance antes de cotizar');
assert.equal(missingScope.nextAction.tab, 'requisitos');

const exploratory = buildCommercialDecision({ ...common, match: { score: 48, level: 'exploratory', reason: 'Solo una señal débil.', matchedSources: ['título'] } });
assert.equal(exploratory.label, 'Señal exploratoria');
assert.equal(exploratory.tone, 'muted');
assert.equal(exploratory.nextAction.tab, 'catalogo');

const noCatalog = buildCommercialDecision({ ...common, match: { score: null, level: 'unavailable', reason: 'No hay productos configurados.' } });
assert.equal(noCatalog.nextAction.tab, 'catalogo');

process.stdout.write('commercialDecision.unit: ok\n');
