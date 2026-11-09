import assert from 'node:assert/strict';
import { formatChileanRut, normalizeChileanRut } from '../src/chileanRut.js';

assert.equal(normalizeChileanRut('76.123.456-0'), '761234560');
assert.equal(normalizeChileanRut('761234560'), '761234560');
assert.equal(formatChileanRut('761234560'), '76.123.456-0');
assert.equal(normalizeChileanRut('76.123.456-1'), null);
assert.equal(normalizeChileanRut('0-0'), null);
assert.equal(normalizeChileanRut('12.34x.678-5'), null);
console.log('PASS validación y normalización de RUT chileno.');
