import assert from 'node:assert/strict';
import { officialAmountWrite, parseTenderAmount, tenderAmountStatus } from '../src/tenderAmount.js';
import { listingAmountDisplay } from '../../src/listingAmountDisplay.js';

const published = { MontoEstimado: '19000000', VisibilidadMonto: 1 };
assert.equal(parseTenderAmount(published.MontoEstimado), 19_000_000);
assert.equal(tenderAmountStatus(published.MontoEstimado, published.VisibilidadMonto), 'published');
assert.deepEqual(officialAmountWrite(published), { mode: 'replace', amount: 19_000_000 });
assert.equal(listingAmountDisplay(19_000_000, 'published', value => `$${value}`), '$19000000');

const notPublic = { MontoEstimado: null, VisibilidadMonto: 0 };
assert.equal(tenderAmountStatus(notPublic.MontoEstimado, notPublic.VisibilidadMonto), 'not_public');
assert.deepEqual(officialAmountWrite(notPublic), { mode: 'clear', amount: null });
assert.equal(listingAmountDisplay(null, 'not_public', String), 'No publicado');

const missingFromResponse = { MontoEstimado: null, VisibilidadMonto: 1 };
assert.equal(tenderAmountStatus(missingFromResponse.MontoEstimado, missingFromResponse.VisibilidadMonto), 'source_missing');
assert.deepEqual(officialAmountWrite(missingFromResponse), { mode: 'preserve', amount: null });
assert.equal(listingAmountDisplay(null, 'source_missing', String), 'La fuente no devolvió el monto');

assert.equal(parseTenderAmount(0), 0, 'a legitimate zero must not be treated as missing');
assert.equal(tenderAmountStatus(null, null), 'unverified');
assert.equal(listingAmountDisplay(null, 'unverified', String), 'Pendiente de consulta oficial');
assert.deepEqual(officialAmountWrite({}), { mode: 'preserve', amount: null });
assert.equal(parseTenderAmount('not-a-number'), null);

console.log('PASS tender amount source classification, persistence policy, search mapping, and UI labels.');
