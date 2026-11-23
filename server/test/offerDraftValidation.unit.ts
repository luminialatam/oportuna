import assert from 'node:assert/strict';
import { offerDraftSchema } from '../src/offerDraftValidation.js';

const legacyDraft = {
  quoteName: 'Oferta de prueba', details: '', responsible: '', deadline: '', declarationReviewed: false,
  items: { bomba: { enabled: true, unitPrice: '100000', specification: 'Acero inoxidable', comment: '' } },
  documents: [],
};
const legacyParsed = offerDraftSchema.parse(legacyDraft);
assert.equal(legacyParsed.minimumMarginPercent, '');
assert.equal(legacyParsed.items.bomba.directUnitCost, '');

const currentParsed = offerDraftSchema.parse({
  ...legacyDraft,
  minimumMarginPercent: '25.5',
  items: { bomba: { ...legacyDraft.items.bomba, directUnitCost: '70000' } },
});
assert.equal(currentParsed.minimumMarginPercent, '25.5');
assert.equal(currentParsed.items.bomba.directUnitCost, '70000');

assert.equal(offerDraftSchema.safeParse({ ...legacyDraft, minimumMarginPercent: '101' }).success, false);
assert.equal(offerDraftSchema.safeParse({ ...legacyDraft, items: { bomba: { ...legacyDraft.items.bomba, directUnitCost: '-1' } } }).success, false);

process.stdout.write('offerDraftValidation.unit: ok\n');
