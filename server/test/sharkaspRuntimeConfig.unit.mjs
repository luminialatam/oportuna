import assert from 'node:assert/strict';
import { fixedEnvironment } from '../../deploy/sharkasp/sharkasp-runtime-config.mjs';

const origins = fixedEnvironment.CLIENT_ORIGIN.split(',');
assert.equal(origins[0], 'https://tailflow.pro', 'canonical email and CORS origin must be tailflow.pro');
assert.deepEqual(origins, [
  'https://tailflow.pro',
  'https://luminiadev-001-site5.ltempurl.com',
], 'the provider hostname remains available only as the explicit secondary staging origin');

process.stdout.write('PASS SharkASP bootstrap uses tailflow.pro as canonical origin and keeps the provider hostname secondary.\n');
