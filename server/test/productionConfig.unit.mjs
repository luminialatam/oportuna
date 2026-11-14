import assert from 'node:assert/strict';
import { validateProductionEnvironment } from '../../deploy/sharkasp/productionConfig.mjs';

const required = {
  APP_ENV: 'production', NODE_ENV: 'production', PROCESS_ROLE: 'web', HOST: '127.0.0.1',
  CLIENT_ORIGIN: 'https://tailflow.pro', TRUST_PROXY_HOPS: '1', DB_HOST: 'db.example.invalid',
  DB_PORT: '3306', DB_NAME: 'oportuna', DB_USER: 'oportuna', DB_PASSWORD: 'test-only-password',
  DB_SSL: 'true', DB_SSL_MODE: 'VERIFY_IDENTITY', MERCADOPUBLICO_TICKET: 'test-ticket',
  SYNC_API_TOKEN: 'x'.repeat(40), EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'mail.example.invalid',
  SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USERNAME: 'qa@example.invalid',
  SMTP_PASSWORD: 'test-only-password', SMTP_FROM: 'qa@example.invalid', PORT: '3000',
};

assert.deepEqual(validateProductionEnvironment(required), { missing: [], invalid: [] });
const missing = validateProductionEnvironment({ ...required, DB_PASSWORD: '' });
assert.ok(missing.missing.includes('DB_PASSWORD'));
assert.ok(!JSON.stringify(missing).includes('test-only-password'));
const insecure = validateProductionEnvironment({ ...required, DB_SSL: 'false' });
assert.ok(insecure.invalid.includes('DB_SSL'));
const workers = validateProductionEnvironment({ ...required, ALERT_SCHEDULER_ENABLED: 'true' });
assert.ok(workers.invalid.includes('ALERT_SCHEDULER_ENABLED'));
process.stdout.write('Production config validation tests passed; output contains names only.\n');
