import assert from 'node:assert/strict';
import { scoreSearchEvidence } from '../src/searchRelevance.js';

const groups = (literal: string[]) => ({ literal, core: literal, synonyms: [], related: [], all: literal });
const score = (query: string, title: string, literal: string[], code = 'TEST-1') => scoreSearchEvidence({
  query, code, title, organization: '', description: '', itemNames: '', itemDescriptions: '', groups: groups(literal),
});

const pendon = score('pendones', 'SERVICIOS DE IMPRESIÓN DE PENDONES INFORMATIVOS', ['pendon']);
assert.equal(pendon.score, 100, 'Accent-insensitive exact title hit should remain fully relevant.');
assert.equal(pendon.level, 'high');

const partialGastronomic = score('equipamiento gastronómico', 'EQUIPAMIENTO MÉDICO DESTINADO A CENTROS DE SALUD', ['equipamiento', 'gastronomico']);
assert.ok(partialGastronomic.score < 75, 'A single generic term must not receive a high relevance score for a two-term query.');
assert.equal(partialGastronomic.level, 'exploratory', 'one hit in a multi-term query is exploratory, not a medium recommendation.');
assert.deepEqual(partialGastronomic.titleHits, ['equipamiento']);
assert.equal(partialGastronomic.phraseInTitle, false);

const placeNameMill = score('molino coloidal industrial', 'CONSTRUCCIÓN PLAZA LOS MOLINOS', ['molino', 'coloidal', 'industrial']);
assert.equal(placeNameMill.level, 'exploratory', 'a single «molino» token must not be a medium commercial recommendation for a three-term query.');

const equivalentEquipment = score('equipamiento gastronómico', 'MANTENCIÓN EQUIPOS GASTRONÓMICOS Y REFRIGERACIÓN', ['equipamiento', 'gastronomico']);
assert.ok(equivalentEquipment.score >= 85, 'Equipo(s) is a documented textual variant of equipamiento for ranking evidence.');
assert.equal(equivalentEquipment.level, 'high');

const fullLab = score('equipos de laboratorio', 'ADQUISICIÓN DE EQUIPOS PARA LABORATORIO', ['equipo', 'laboratorio']);
assert.equal(fullLab.level, 'high', 'A title containing all query concepts remains a strong match.');
assert.equal(fullLab.coverage, 1);
const labPurchase = score('equipos de laboratorio', 'ADQUISICIÓN MATERIALES EQUIPOS E INSTRUMENTOS DE LABORATORIO', ['equipo', 'laboratorio']);
assert.equal(labPurchase.score, 99, 'An acquisition title with all requested product terms outranks related service listings.');

const ambiguousMill = scoreSearchEvidence({
  query: 'molinos', code: 'PLACE-1', title: 'CONSTRUCCIÓN PLAZA LOS MOLINOS', organization: '', description: '', itemNames: '', itemDescriptions: '', groups: groups(['molino']), ambiguous: true,
});
assert.equal(ambiguousMill.score, 60, 'Ambiguous single-word place-name matches stay visible but are not presented as high commercial fit.');
assert.equal(ambiguousMill.level, 'medium');

const exactCode = score('TEST-1', 'Completely unrelated listing', ['test']);
assert.equal(exactCode.score, 100, 'Exact code lookup must take priority.');
assert.equal(exactCode.level, 'high');

console.log('smart search relevance: 6 assertions passed');
