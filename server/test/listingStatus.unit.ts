import assert from 'node:assert/strict';
import { listingAvailability } from '../src/listingStatus.js';

const afterOvenDeadline = Date.parse('2026-11-02T18:02:00Z');
assert.deepEqual(listingAvailability(5, '2026-11-02T18:01:00Z', afterOvenDeadline), {
  status: 'expired', label: 'Plazo vencido; verificar estado actualizado', isOpen: false,
});
assert.equal(listingAvailability(5, '2026-11-03T18:01:00Z', afterOvenDeadline).isOpen, true, 'the dishwasher remains open before its listed deadline');
assert.equal(listingAvailability(5, '2026-11-05T18:30:00Z', afterOvenDeadline).isOpen, true, 'the known pendones case remains open before its listed deadline');
assert.equal(listingAvailability(5, null, afterOvenDeadline).isOpen, null, 'a published state without a close date is not asserted open');
assert.equal(listingAvailability(6, '2026-11-05T18:30:00Z', afterOvenDeadline).isOpen, false, 'a closed source state wins over a future cached deadline');
console.log('PASS listing status requires an unexpired close date and a published source state before showing an opportunity open.');
