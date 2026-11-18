import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import argon2 from 'argon2';

const pkg = await import('../../package.json', { with: { type: 'json' } });
assert.equal(pkg.default.scripts.start, 'node dist-server/server/src/index.js', 'Railpack start script must run the compiled Express server.');
assert.equal(pkg.default.engines?.node, '22.x', 'Railpack Node runtime must stay pinned to the supported major.');
assert.equal(existsSync(join(process.cwd(), 'app_offline.htm')), false, 'IIS app_offline marker must never be tracked or included in the source checkout.');
assert.equal(existsSync(join(process.cwd(), 'sharkasp-bootstrap.mjs')), true, 'IIS Node.js Application startup file must be present at the site root.');
assert.equal(existsSync(join(process.cwd(), 'node_modules/argon2/prebuilds/win32-x64/argon2.glibc.node')), true, 'The Linux-built runtime dependency tree must carry Argon2 N-API prebuild for Windows x64 IIS.');
if (process.env.RAILPACK_CI === 'true') {
  assert.equal(process.platform, 'linux', 'Railpack CI runtime check must run on Linux.');
  assert.equal(process.arch, 'x64', 'SharkASP Railpack Node runtime must be Linux x64.');
}

const password = 'local-railpack-argon2-check';
const hash = await argon2.hash(password, { type: argon2.argon2id });
assert.equal(await argon2.verify(hash, password), true, 'Argon2id must hash and verify on the installed runtime.');

const portServer = createServer();
await new Promise((resolve, reject) => {
  portServer.once('error', reject);
  portServer.listen(0, '127.0.0.1', resolve);
});
const address = portServer.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

const dotenvPath = join(tmpdir(), `oportuna-railpack-no-dotenv-${process.pid}`);
await assert.rejects(access(dotenvPath), 'the smoke-test dotenv marker must not exist');
const childEnv = {
  ...process.env,
  APP_ENV: 'production',
  NODE_ENV: 'production',
  PROCESS_ROLE: 'web',
  PORT: String(port),
  CLIENT_ORIGIN: 'https://example.invalid',
  TRUST_PROXY_HOPS: '1',
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_USER: 'qa_only',
  DB_PASSWORD: 'qa_only_not_a_real_password',
  DB_NAME: 'qa_only',
  DB_SSL: 'true',
  DB_SSL_MODE: 'VERIFY_IDENTITY',
  MERCADOPUBLICO_TICKET: 'qa_only_not_a_real_ticket',
  SYNC_API_TOKEN: 'qa-only-token-'.padEnd(40, 'x'),
  SYNC_SCHEDULER_ENABLED: 'false',
  ENRICHMENT_WORKER_ENABLED: 'false',
  ALERT_SCHEDULER_ENABLED: 'false',
  DOTENV_CONFIG_PATH: dotenvPath,
  GROQ_API_KEY: '',
};
delete childEnv.HOST;
delete childEnv.HTTP_PLATFORM_PORT;

const child = spawn('npm', ['start'], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let output = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
const base = `http://127.0.0.1:${port}`;
const secureHeaders = { 'x-forwarded-proto': 'https' };

async function fetchReady(url, options) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Express process exited (${child.exitCode}). Output: ${output}`);
    try {
      const response = await fetch(url, options);
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`Express did not become ready: ${lastError}; output: ${output}`);
}

try {
  const page = await fetchReady(`${base}/`, { headers: secureHeaders });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<div id="root">/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith('.js')), 'built HTML must reference a JavaScript bundle');
  assert.ok(assets.some((asset) => asset.endsWith('.css')), 'built HTML must reference a CSS bundle');
  for (const asset of assets) {
    const response = await fetchReady(`${base}${asset}`, { headers: secureHeaders });
    assert.equal(response.status, 200, `built asset must be served: ${asset}`);
    assert.ok(Number(response.headers.get('content-length') ?? '0') > 0 || (await response.text()).length > 0);
  }

  const healthResponse = await fetchReady(`${base}/api/health`, { headers: secureHeaders });
  assert.equal(healthResponse.status, 200);
  const healthBody = await healthResponse.text();
  const health = JSON.parse(healthBody);
  assert.equal(health.ok, true);
  assert.equal(health.apiConfigured, true);
  assert.equal(health.mysql, false, 'isolated smoke test must not connect to a real database');
  assert.deepEqual(Object.keys(health).sort(), ['apiConfigured', 'mysql', 'ok'], 'default public health response must remain unchanged');

  const diagnosticResponse = await fetchReady(`${base}/api/health?diagnostics=1`, { headers: secureHeaders });
  assert.equal(diagnosticResponse.status, 200);
  const diagnosticBody = await diagnosticResponse.text();
  const diagnosticHealth = JSON.parse(diagnosticBody);
  assert.equal(diagnosticHealth.mysql, false);
  assert.equal(diagnosticHealth.mysqlCode, 'DB_CONNECTION_REFUSED', 'opt-in health diagnostics must expose only the sanitized MySQL code');
  assert.deepEqual(Object.keys(diagnosticHealth).sort(), ['apiConfigured', 'mysql', 'mysqlCode', 'ok']);
  for (let attempt = 0; attempt < 20 && !output.includes('[db] health_check_failed code='); attempt += 1) {
    await delay(25);
  }
  assert.match(output, /\[db\] health_check_failed code=DB_CONNECTION_REFUSED/, 'database failure must be classified in logs');
  for (const privateValue of [childEnv.DB_PASSWORD, childEnv.MERCADOPUBLICO_TICKET, childEnv.SYNC_API_TOKEN]) {
    assert.equal(output.includes(privateValue), false, 'database diagnostics must not log secrets');
    assert.equal(healthBody.includes(privateValue), false, 'health response must not expose secrets');
    assert.equal(diagnosticBody.includes(privateValue), false, 'health diagnostic response must not expose secrets');
  }
  assert.match(output, /API Oportuna escuchando en 0\.0\.0\.0:/, 'production Railpack must bind all interfaces');
  console.log('PASS Railpack runtime: npm start, Linux-compatible Argon2id, 0.0.0.0/PORT, SPA assets and API health (isolated DB unavailable as expected).');
} finally {
  if (child.exitCode === null) {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(5000).then(() => { if (child.exitCode === null) { if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } } else child.kill('SIGKILL'); } }),
    ]);
  }
}
