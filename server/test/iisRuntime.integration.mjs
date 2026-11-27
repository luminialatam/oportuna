import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const appRoot = resolve(process.argv[2] ?? '');
assert.ok(process.platform === 'win32' && process.arch === 'x64', 'IIS runtime reproduction must run on Windows x64.');
assert.ok(appRoot !== process.cwd() && existsSync(join(appRoot, 'package.json')), 'Pass the downloaded Linux-built application artifact path.');
for (const file of ['sharkasp-bootstrap.mjs', 'sharkasp-runtime-config.mjs', 'dist/index.html', 'dist-server/server/src/index.js', 'node_modules/argon2/package.json', 'web.config']) {
  assert.ok(existsSync(join(appRoot, file)), `Deployment artifact is missing ${file}.`);
}

const config = readFileSync(join(appRoot, 'web.config'), 'utf8');
assert.match(config, /<add\s+name=["']httpPlatformHandler["']\s+path=["']\*["']\s+verb=["']\*["']\s+modules=["']httpPlatformHandler["']/i, 'IIS must route requests to HttpPlatformHandler.');
assert.match(config, /<httpPlatform\s+processPath=["']node["']\s+arguments=["']sharkasp-bootstrap\.mjs["']/i, 'IIS must launch the root bootstrap.');
assert.match(config, /name=["']PORT["']\s+value=["']%HTTP_PLATFORM_PORT%["']/i, 'web.config must pass the dynamic IIS port.');

const requireFromArtifact = createRequire(join(appRoot, 'package.json'));
const argon2 = requireFromArtifact('argon2');
const password = 'IIS-runtime-fake-password-only';
const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
assert.equal(await argon2.verify(passwordHash, password), true, 'Linux-installed Argon2 dependency must load and hash on Windows x64.');

async function getFreeLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const { port } = address;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

const httpPlatformPort = await getFreeLoopbackPort();
let decoyPort = await getFreeLoopbackPort();
while (decoyPort === httpPlatformPort) decoyPort = await getFreeLoopbackPort();
const fakeSecrets = {
  DB_PASSWORD: 'qa-only-not-a-real-password',
  MERCADOPUBLICO_TICKET: 'qa-only-not-a-real-ticket',
  SYNC_API_TOKEN: 'qa-only-token-'.padEnd(40, 'x'),
};
function runtimeEnvironment(httpPlatformPort, port = httpPlatformPort) {
  return {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  APP_ENV: 'staging', NODE_ENV: 'production', PROCESS_ROLE: 'web',
  CLIENT_ORIGIN: 'https://oportuna.example.invalid', TRUST_PROXY_HOPS: '1',
  DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'qa_only', DB_NAME: 'qa_only', DB_SSL: 'true', DB_SSL_MODE: 'VERIFY_IDENTITY',
  SYNC_SCHEDULER_ENABLED: 'false', ENRICHMENT_WORKER_ENABLED: 'false', ALERT_SCHEDULER_ENABLED: 'false',
  HTTP_PLATFORM_PORT: String(httpPlatformPort), PORT: String(port), HOST: '0.0.0.0',
  DOTENV_CONFIG_PATH: join(appRoot, '.iis-runtime-test-no-dotenv'),
  ...fakeSecrets,
  };
}

function runExpectedStartupFailure(expectedCode, env) {
  const probe = spawnSync(process.execPath, [join(appRoot, 'sharkasp-bootstrap.mjs')], {
    cwd: appRoot,
    env,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const probeOutput = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  assert.equal(probe.error, undefined, `Bootstrap could not complete on ${expectedCode}: ${probe.error?.message ?? 'unknown spawn error'}`);
  assert.equal(probe.signal, null, `Bootstrap was terminated before reporting ${expectedCode}.`);
  assert.notEqual(probe.status, 0, `${expectedCode} must fail fast.`);
  let safeProbeOutput = probeOutput;
  for (const value of Object.values(fakeSecrets)) safeProbeOutput = safeProbeOutput.split(value).join('[redacted]');
  assert.ok(safeProbeOutput.includes(`code=${expectedCode}`), `Expected sanitized ${expectedCode} diagnostic; output=${safeProbeOutput.slice(-1000)}`);
  for (const value of Object.values(fakeSecrets)) assert.ok(!probeOutput.includes(value), 'startup diagnostic must not print configuration values');
  return probeOutput;
}

await runExpectedStartupFailure('DYNAMIC_PORT_INVALID', runtimeEnvironment('', ''));
const missingRequired = runtimeEnvironment(43001, 43002);
delete missingRequired.DB_PASSWORD;
const configFailure = await runExpectedStartupFailure('RUNTIME_CONFIG_INVALID', missingRequired);
assert.ok(configFailure.includes('DB_PASSWORD'), 'runtime preflight should name the missing variable without exposing a value');

const childEnv = runtimeEnvironment(httpPlatformPort, decoyPort);

const child = spawn(process.execPath, [join(appRoot, 'sharkasp-bootstrap.mjs')], {
  cwd: appRoot,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
const origin = `http://127.0.0.1:${httpPlatformPort}`;
const forwardedHeaders = { 'x-forwarded-proto': 'https' };

function safeOutput() {
  let safe = output;
  for (const value of Object.values(fakeSecrets)) safe = safe.split(value).join('[redacted]');
  safe = safe.replace(/(password|ticket|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  return safe.split(/\r?\n/).filter(Boolean).slice(-12).join('\n');
}

async function waitForHttpPlatform() {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Node exited before listening (code=${child.exitCode}).\n${safeOutput()}`);
    try {
      const response = await fetch(`${origin}/api/health`, { headers: forwardedHeaders, signal: AbortSignal.timeout(500) });
      if (response.status < 500) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error instanceof Error ? error.name : 'network failure'; }
    await delay(150);
  }
  throw new Error(`IIS could not reach the Node listener on HTTP_PLATFORM_PORT (${lastError ?? 'not listening'}).\n${safeOutput()}`);
}

try {
  const healthResponse = await waitForHttpPlatform();
  assert.equal(healthResponse.status, 200, 'HTTP Platform Handler target must return health JSON.');
  assert.match(healthResponse.headers.get('content-type') ?? '', /application\/json/);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.apiConfigured, true);
  assert.equal(health.mysql, false, 'database connection is intentionally loopback-only and unavailable');

  const page = await fetch(`${origin}/`, { headers: forwardedHeaders });
  assert.equal(page.status, 200, 'Express must serve frontend HTML after IIS handoff.');
  const html = await page.text();
  assert.match(html, /<div id="root">/);
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith('.js')) && assets.some((asset) => asset.endsWith('.css')));
  for (const asset of assets) assert.equal((await fetch(`${origin}${asset}`, { headers: forwardedHeaders })).status, 200, `IIS handoff serves ${asset}`);

  assert.match(output, new RegExp(`API Oportuna escuchando en 127\\.0\\.0\\.1:${httpPlatformPort} `), 'bootstrap must prefer HTTP_PLATFORM_PORT and bind loopback for IIS.');
  assert.ok(!output.includes(String(decoyPort)), 'the unrelated PORT value must not override HTTP_PLATFORM_PORT');
  for (const value of Object.values(fakeSecrets)) assert.ok(!output.includes(value), 'startup logs must not expose even test secrets');
  console.log('PASS IIS runtime reproduction: Linux-built artifact starts under Windows x64; Argon2id loads; web.config routes to bootstrap; HTTP_PLATFORM_PORT wins; loopback serves HTML/assets and /api/health. MySQL was not contacted beyond loopback port 1.');
} catch (error) {
  console.error(`FAIL IIS runtime reproduction: ${error instanceof Error ? error.message : 'unclassified error'}`);
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), delay(5000)]);
  }
}
