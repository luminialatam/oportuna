import assert from 'node:assert/strict';
import { calculateOfferEconomics, formatCLP } from './offerEconomics.js';

const profitable = calculateOfferEconomics({ unitPrice: '150000', unitCost: '90000', quantity: 3, minimumMarginPercent: '35' });
assert.equal(profitable.grossProfit, 180000);
assert.equal(profitable.grossMarginPercent, 40);
assert.equal(profitable.target, 'met');
assert.equal(profitable.revenue, 450000);

const belowTarget = calculateOfferEconomics({ unitPrice: '100', unitCost: '85', quantity: 2, minimumMarginPercent: '20' });
assert.equal(belowTarget.grossMarginPercent, 15);
assert.equal(belowTarget.target, 'below');

const missingQuantity = calculateOfferEconomics({ unitPrice: '100', unitCost: '70', quantity: null, minimumMarginPercent: '' });
assert.equal(missingQuantity.unitGrossProfit, 30);
assert.equal(missingQuantity.grossMarginPercent, 30);
assert.equal(missingQuantity.grossProfit, null);
assert.equal(missingQuantity.target, 'not-set');

const incomplete = calculateOfferEconomics({ unitPrice: '100', unitCost: '', quantity: 1, minimumMarginPercent: '10' });
assert.equal(incomplete.grossMarginPercent, null);
assert.equal(incomplete.target, 'incomplete');

const invalid = calculateOfferEconomics({ unitPrice: 'no', unitCost: '-2', quantity: 0, minimumMarginPercent: '120' });
assert.equal(invalid.unitPrice, null);
assert.equal(invalid.unitCost, null);
assert.equal(invalid.quantity, null);
assert.equal(invalid.target, 'not-set');
assert.equal(formatCLP(10300000), '$10.300.000');

process.stdout.write('offerEconomics.unit: ok\n');
