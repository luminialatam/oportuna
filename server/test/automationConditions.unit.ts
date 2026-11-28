import assert from 'node:assert/strict';
import { automationCandidateMatches } from '../src/automationConditions.js';

const candidate = { code: 'LIC-1', title: 'Mantención de equipos', region: 'Región Metropolitana', category: 'Mantenimiento', text: 'Mantención preventiva bombas de agua', score: 82, eventKey: 'match:LIC-1', dueAt: null };
assert.equal(automationCandidateMatches(candidate, { region: 'metropolitana', category: 'mantenimiento', keywords: ['bombas'], minAffinity: 80 }, 'new_match'), true);
assert.equal(automationCandidateMatches(candidate, { keywords: ['ascensores'] }, 'new_match'), false);
assert.equal(automationCandidateMatches(candidate, { minAffinity: 90 }, 'new_match'), false);
assert.equal(automationCandidateMatches({ ...candidate, score: null }, { minAffinity: 0 }, 'closing_soon'), false);
assert.equal(automationCandidateMatches(candidate, { minAffinity: 0 }, 'closing_soon'), false);
process.stdout.write('automationConditions.unit: ok\n');
