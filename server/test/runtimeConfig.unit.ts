import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../src/runtimeConfig.js';
import { MemoryRateLimitStore } from '../src/rateLimitStore.js';

const local = loadRuntimeConfig({ APP_ENV: 'development', PORT: '4000' } as NodeJS.ProcessEnv);
assert.equal(local.host, '127.0.0.1');
assert.equal(local.trustProxyHops, 0);
assert.equal(local.secureCookies, false);
assert.equal(local.sharedRateLimits, false);
const iisPort = loadRuntimeConfig({ APP_ENV: 'development', HTTP_PLATFORM_PORT: '49127' } as NodeJS.ProcessEnv);
assert.equal(iisPort.port, 49127);

assert.throws(() => loadRuntimeConfig({ APP_ENV: 'production' } as NodeJS.ProcessEnv), /Faltan variables obligatorias/);
assert.throws(() => loadRuntimeConfig({ APP_ENV: 'development', CLIENT_ORIGIN: '*' } as NodeJS.ProcessEnv), /no se admite/);
assert.throws(() => loadRuntimeConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), /no se permite asumir desarrollo/);
assert.throws(() => loadRuntimeConfig({ APP_ENV: 'development', NODE_ENV: 'production' } as NodeJS.ProcessEnv), /no es válido/);
const production = loadRuntimeConfig({
  APP_ENV: 'staging', NODE_ENV: 'production', PROCESS_ROLE: 'web', HOST: '0.0.0.0', PORT: '4000',
  CLIENT_ORIGIN: 'https://staging.example.test', TRUST_PROXY_HOPS: '1', DB_HOST: 'db.internal', DB_USER: 'oportuna',
  DB_PASSWORD: 'placeholder-only', DB_NAME: 'oportuna', DB_SSL: 'true', MERCADOPUBLICO_TICKET: 'placeholder-only',
  SYNC_API_TOKEN: 'x'.repeat(32), ENRICHMENT_WORKER_ENABLED: 'false', SYNC_SCHEDULER_ENABLED: 'false', ALERT_SCHEDULER_ENABLED: 'false',
} as NodeJS.ProcessEnv);
assert.equal(production.secureCookies, true);
assert.equal(production.sharedRateLimits, true);
assert.equal(production.processRole, 'web');
assert.throws(() => loadRuntimeConfig({
  APP_ENV: 'production', NODE_ENV: 'production', PROCESS_ROLE: 'web', HOST: '0.0.0.0', PORT: '4000',
  CLIENT_ORIGIN: 'https://app.example.test', TRUST_PROXY_HOPS: '1', DB_HOST: 'db.internal', DB_USER: 'oportuna',
  DB_PASSWORD: 'placeholder-only', DB_NAME: 'oportuna', DB_SSL: 'true', MERCADOPUBLICO_TICKET: 'placeholder-only',
  SYNC_API_TOKEN: 'x'.repeat(32), SYNC_SCHEDULER_ENABLED: 'true',
} as NodeJS.ProcessEnv), /solo puede activarse en PROCESS_ROLE=sync-worker/);

const store = new MemoryRateLimitStore();
const now = 1_800_000_000_000;
assert.equal((await store.consume('test', 2, 60_000, now)).allowed, true);
assert.equal((await store.consume('test', 2, 60_000, now + 1)).allowed, true);
const blocked = await store.consume('test', 2, 60_000, now + 2);
assert.equal(blocked.allowed, false);
assert.ok(blocked.retryAfterSeconds > 0);
assert.equal((await store.consume('test', 2, 60_000, now + 60_000)).allowed, true);

console.log('PASS runtime config, secure proxy defaults and rate-limit store behavior.');
