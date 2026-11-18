import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pool from '../src/db.js';
import { createUser } from '../src/authService.js';

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbName = process.env.DB_NAME || 'oportuna';
assert.ok(process.env.DB_SOCKET?.trim() || ['127.0.0.1', 'localhost', '::1'].includes(dbHost), 'Profile validation tests require a local database.');
assert.ok(!/(prod|sharkasp|shark|live)/i.test(dbName), 'Profile validation tests refuse production-like database names.');

const root = resolve(import.meta.dirname, '../..');
const suffix = randomUUID();
const email = `qa-profile-validation-${suffix}@invalid.example`;
const companyName = `QA Perfil ${suffix}`;
const password = 'Temporary-QA-Profile-Validation-2026!';
let userId = 0;
let companyId = 0;
let port = 0;
let child: ReturnType<typeof spawn> | undefined;

type Jar = { sid: string; csrf: string };
function cookies(response: Response): Jar {
  const parts = ((response.headers as any).getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']).flatMap((value: string) => value.split(/,(?=[^;,]+=)/));
  const get = (name: string) => parts.map((part: string) => part.trim()).find((part: string) => part.startsWith(`${name}=`))?.split(';', 1)[0].slice(name.length + 1) ?? '';
  return { sid: decodeURIComponent(get('oportuna.sid')), csrf: decodeURIComponent(get('oportuna.csrf')) };
}
const origin = () => `http://127.0.0.1:${port}`;
async function request(path: string, options: RequestInit = {}, jar?: Jar) {
  const headers = new Headers(options.headers);
  headers.set('Origin', origin());
  if (jar) {
    headers.set('Cookie', `oportuna.sid=${encodeURIComponent(jar.sid)}; oportuna.csrf=${encodeURIComponent(jar.csrf)}`);
    if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase())) headers.set('X-CSRF-Token', jar.csrf);
  }
  return fetch(`${origin()}${path}`, { ...options, headers, credentials: 'same-origin' });
}

const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
port = (probe.address() as any).port;
await new Promise<void>((resolveClose, reject) => probe.close(error => error ? reject(error) : resolveClose()));

try {
  userId = await createUser(email, password, 'user', 'QA', 'Perfil');
  const [company] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [companyName]);
  companyId = Number(company.insertId);
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')", [userId, companyId]);

  child = spawn(process.execPath, [
    '--require', resolve(root, 'node_modules/tsx/dist/preflight.cjs'),
    '--import', pathToFileURL(resolve(root, 'node_modules/tsx/dist/loader.mjs')).href,
    resolve(root, 'server/src/index.ts'),
  ], { cwd: root, env: { ...process.env, APP_ENV: 'development', NODE_ENV: 'development', PROCESS_ROLE: 'web', PORT: String(port), HOST: '127.0.0.1', CLIENT_ORIGIN: origin(), EMAIL_TRANSPORT: 'simulated', SYNC_SCHEDULER_ENABLED: 'false', ENRICHMENT_WORKER_ENABLED: 'false', ALERT_SCHEDULER_ENABLED: 'false' }, stdio: ['ignore', 'ignore', 'ignore'] });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Local profile API exited during startup.');
    try { if ((await fetch(`${origin()}/api/health`)).ok) { ready = true; break; } } catch { /* waiting for local startup */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  assert.ok(ready, 'local profile API started');

  const login = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200);
  const jar = cookies(login);
  assert.ok(jar.sid && jar.csrf, 'session and CSRF cookies are present');
  const loaded = await request('/api/company/profile', {}, jar);
  assert.equal(loaded.status, 200);
  const { profile } = await loaded.json() as any;

  // This is the Profile form shape: empty optional text values and arrays plus four independent line lists.
  const payload = {
    ...profile,
    nombreComercial: companyName,
    razonSocial: '',
    rut: '',
    emailContacto: '',
    telefono: '',
    direccion: '',
    comuna: '',
    regionPrincipal: '',
    sitioWeb: '',
    descripcionComercial: '',
    actividad: '',
    rubros: ['Servicios de impresión', 'Papelería'],
    regiones: ['Región Metropolitana', 'Valparaíso'],
    palabrasClave: ['impresión digital', 'pendones'],
    terminosExcluidos: ['arriendo', 'usado'],
    estados: [5, 6],
  };

  const badEmail = await request('/api/company/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, emailContacto: 'correo-sin-formato' }) }, jar);
  assert.equal(badEmail.status, 400);
  const badEmailBody = await badEmail.json() as any;
  assert.match(badEmailBody.fieldErrors.emailContacto, /correo.*formato válido/i, 'malformed optional email is rejected with its field-specific error');

  const missingName = await request('/api/company/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, nombreComercial: '' }) }, jar);
  assert.equal(missingName.status, 400);
  assert.match((await missingName.json() as any).fieldErrors.nombreComercial, /obligatorio/i, 'required company name is explained before persistence');

  const invalidList = await request('/api/company/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, rubros: ['X'] }) }, jar);
  assert.equal(invalidList.status, 400);
  assert.match((await invalidList.json() as any).fieldErrors.rubros, /Línea 1/);

  const saved = await request('/api/company/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, jar);
  assert.equal(saved.status, 200, 'empty optional email and other optional fields are accepted');
  const firstSave = await saved.json() as any;
  assert.equal(firstSave.profile.emailContacto, '', 'empty email round-trips as an empty form value');
  for (const key of ['rubros', 'regiones', 'palabrasClave', 'terminosExcluidos']) assert.deepEqual(firstSave.profile[key], payload[key], `${key} saves without concatenation or duplicates`);

  const reloaded = await request('/api/company/profile', {}, jar);
  assert.equal(reloaded.status, 200);
  const persisted = (await reloaded.json() as any).profile;
  assert.equal(persisted.nombreComercial, companyName);
  assert.equal(persisted.emailContacto, '');
  assert.equal(persisted.sitioWeb, '');
  assert.equal(persisted.telefono, '');
  for (const key of ['rubros', 'regiones', 'palabrasClave', 'terminosExcluidos']) assert.deepEqual(persisted[key], payload[key], `${key} remains in its original line and field after reload`);
  console.log('PASS company profile validation: empty optional email, field-level errors, valid save, four independent lists, optional blanks, database round-trip and reload.');
} catch (error) {
  console.error('FAIL company profile validation local integration:', error instanceof Error ? error.stack : 'unknown error');
  process.exitCode = 1;
} finally {
  if (child && !child.killed) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolveWait => setTimeout(resolveWait, 5000))]); }
  try {
    if (companyId) await pool.execute('DELETE FROM companies WHERE id=?', [companyId]);
    if (userId) await pool.execute('DELETE FROM app_users WHERE id=?', [userId]);
    const [companies] = await pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE nombre_comercial=?', [companyName]);
    const [users] = await pool.query<any[]>('SELECT COUNT(*) total FROM app_users WHERE email_normalized=?', [email]);
    assert.equal(Number(companies[0].total), 0, 'temporary company removed');
    assert.equal(Number(users[0].total), 0, 'temporary test user removed');
    console.log('CLEANUP PASS: temporary profile company and user removed.');
  } catch (error) {
    console.error('CLEANUP FAIL:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  }
  await pool.end();
}
