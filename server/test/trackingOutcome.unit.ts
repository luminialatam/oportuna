import assert from 'node:assert/strict';
import { outcomeSummary, validateTrackingOutcome, type TrackingOutcomeInput } from '../src/trackingOutcome.js';

const valid: TrackingOutcomeInput = {
  outcome: 'awarded', offerAmount: 1_200_000, awardedAmount: 1_100_000, actualCost: 800_000,
  currency: 'CLP', sourceUrl: 'https://www.mercadopublico.cl/licitaciones/123', decidedAt: '2026-11-28', notes: 'Revisado en acta oficial',
};

assert.deepEqual(validateTrackingOutcome(valid), valid);
assert.equal(outcomeSummary(valid).grossDifference, 300_000);
assert.equal(outcomeSummary({ ...valid, outcome: 'not_awarded' }).grossDifference, null);
assert.throws(() => validateTrackingOutcome({ ...valid, offerAmount: -1 }), /no negativo/);
assert.throws(() => validateTrackingOutcome({ ...valid, actualCost: Number.NaN }), /número no negativo válido/);
assert.throws(() => validateTrackingOutcome({ ...valid, sourceUrl: 'http://mercadopublico.cl' }), /HTTPS/);
assert.throws(() => validateTrackingOutcome({ ...valid, decidedAt: '2026-02-30' }), /fecha.*válida/);

process.stdout.write('tracking outcome validation passed\n');
