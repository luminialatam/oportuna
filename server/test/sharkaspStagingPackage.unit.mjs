import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeConfig = resolve(root, 'deploy/sharkasp/sharkasp-runtime-config.staging.mjs');
const webConfig = readFileSync(resolve(root, 'deploy/sharkasp/web.config.staging.template'), 'utf8');
const packager = readFileSync(resolve(root, 'deploy/sharkasp/Prepare-Windows-Package.ps1'), 'utf8');
const bootstrap = readFileSync(resolve(root, 'sharkasp-bootstrap.mjs'), 'utf8');

function loadStagingConfig(env) {
  const code = `const { fixedEnvironment } = await import(${JSON.stringify(runtimeConfig)}); process.stdout.write(JSON.stringify(fixedEnvironment));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const staging = loadStagingConfig({
  ...process.env,
  DB_HOST: 'stage-mysql.example.invalid',
  DB_PORT: '3306',
  DB_NAME: 'oportuna_stage',
  DB_USER: 'oportuna_stage_user',
  DB_SSL_MODE: 'VERIFY_IDENTITY',
  CLIENT_ORIGIN: 'https://stage.example.invalid',
  TRUST_PROXY_HOPS: '1',
  OPORTUNA_PRIVATE_SECRETS_PATH: '../oportuna-stage-private/secrets.json',
});
assert.equal(staging.APP_ENV, 'staging');
assert.equal(staging.PROCESS_ROLE, 'web');
assert.equal(staging.DB_HOST, 'stage-mysql.example.invalid');
assert.equal(staging.DB_NAME, 'oportuna_stage');
assert.equal(staging.CLIENT_ORIGIN, 'https://stage.example.invalid');
assert.equal(staging.OPORTUNA_DEPLOYMENT_PROFILE, 'isolated-staging');
assert.equal(staging.OPORTUNA_PRIVATE_SECRETS_PATH, '../oportuna-stage-private/secrets.json');
assert.equal(staging.SYNC_SCHEDULER_ENABLED, 'false');
assert.equal(staging.ENRICHMENT_WORKER_ENABLED, 'false');
assert.equal(staging.ALERT_SCHEDULER_ENABLED, 'false');

const legacyTarget = loadStagingConfig({
  ...process.env,
  DB_HOST: 'mysql1002.site4now.net',
  DB_PORT: '3306',
  DB_NAME: 'db_ac9392_licitapp',
  DB_USER: 'ac9392_licitapp',
});
assert.equal(legacyTarget.DB_HOST, '', 'staging refuses the shared live DB target');
assert.equal(legacyTarget.DB_NAME, '');
assert.equal(legacyTarget.DB_USER, '');

const legacySchemaWithDifferentUser = loadStagingConfig({
  ...process.env,
  DB_HOST: 'mysql1002.site4now.net',
  DB_PORT: '3306',
  DB_NAME: 'db_ac9392_licitapp',
  DB_USER: 'oportuna_stage_user',
});
assert.equal(legacySchemaWithDifferentUser.DB_HOST, '', 'changing MySQL user cannot make the shared production schema a staging target');

assert.match(webConfig, /name="PORT"\s+value="%HTTP_PLATFORM_PORT%"/);
assert.match(webConfig, /name="PROCESS_ROLE"\s+value="web"/);
assert.match(webConfig, /name="SYNC_SCHEDULER_ENABLED"\s+value="false"/);
assert.match(webConfig, /name="ENRICHMENT_WORKER_ENABLED"\s+value="false"/);
assert.match(webConfig, /name="ALERT_SCHEDULER_ENABLED"\s+value="false"/);
assert.doesNotMatch(webConfig, /<rewrite\b/i);
assert.match(packager, /ValidateSet\('Smoke', 'Staging', 'Production'\)/);
assert.match(packager, /sharkasp-runtime-config\.staging\.mjs/);
assert.match(bootstrap, /OPORTUNA_DEPLOYMENT_PROFILE === 'isolated-staging'/);
assert.match(bootstrap, /Staging debe usar un archivo de secretos separado/);

const plan = spawnSync(process.execPath, [resolve(root, 'server/scripts/applySharkAspStagingMigrations.mjs'), '--plan'], {
  cwd: root,
  encoding: 'utf8',
  env: { PATH: process.env.PATH, NODE_ENV: 'test' },
});
assert.equal(plan.status, 0, plan.stderr);
assert.match(plan.stdout, /001–018; 18 archivos ascendentes/);
assert.match(plan.stdout, /017_company_offer_drafts\.sql/);
assert.match(plan.stdout, /018_analytics_saved_views\.sql/);
assert.doesNotMatch(plan.stdout, /012_authentication\.down\.sql/);
assert.match(plan.stdout, /No se leyó configuración de base ni se conectó a ningún servidor/);

const blockedTarget = spawnSync(process.execPath, [resolve(root, 'server/scripts/applySharkAspStagingMigrations.mjs'), '--check'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    PATH: process.env.PATH,
    STAGING_DB_HOST: 'mysql1002.site4now.net',
    STAGING_DB_PORT: '3306',
    STAGING_DB_NAME: 'db_ac9392_licitapp',
    STAGING_DB_USER: 'ac9392_licitapp',
  },
});
assert.notEqual(blockedTarget.status, 0);
assert.match(blockedTarget.stderr, /se bloqueó la conexión de staging/);
assert.doesNotMatch(blockedTarget.stderr, /Contraseña MySQL staging/);

console.log('PASS SharkASP staging package: isolated DB settings, dedicated secrets, web-only workers off, and 001–018 migration plan.');
