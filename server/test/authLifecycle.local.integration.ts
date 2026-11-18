import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pool from '../src/db.js';

const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbName = process.env.DB_NAME || 'oportuna';
assert.ok(process.env.DB_SOCKET?.trim() || ['127.0.0.1', 'localhost', '::1'].includes(dbHost), 'Auth lifecycle tests require a local database.');
assert.ok(!/(prod|sharkasp|shark|live)/i.test(dbName), 'Auth lifecycle tests refuse production-like database names.');

const root = resolve(import.meta.dirname, '../..');
const suffix = randomUUID();
const email = `qa-auth-lifecycle-${suffix}@invalid.example`;
const originalPassword = 'Temporary-QA-Auth-Lifecycle-2026!';
const recoveredPassword = 'Temporary-QA-Recovered-2026!';
const changedPassword = 'Temporary-QA-Changed-2026!';
let userId = 0;
let child: ReturnType<typeof spawn> | undefined;
let output = '';
let port = 0;

type Jar = { sid: string; csrf: string };
function parseCookies(response: Response): Jar {
  const values = (response.headers as any).getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
  const all = values.flatMap((value: string) => value.split(/,(?=[^;,]+=)/));
  const value = (name: string) => all.map((part: string) => part.trim()).find((part: string) => part.startsWith(`${name}=`))?.split(';', 1)[0].slice(name.length + 1) ?? '';
  return { sid: decodeURIComponent(value('oportuna.sid')), csrf: decodeURIComponent(value('oportuna.csrf')) };
}
const originFor = () => `http://127.0.0.1:${port}`;
async function request(path: string, options: RequestInit = {}, jar?: Jar) {
  const headers = new Headers(options.headers);
  headers.set('Origin', originFor());
  if (jar) {
    headers.set('Cookie', `oportuna.sid=${encodeURIComponent(jar.sid)}; oportuna.csrf=${encodeURIComponent(jar.csrf)}`);
    if (!['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase())) headers.set('X-CSRF-Token', jar.csrf);
  }
  return fetch(`${originFor()}${path}`, { ...options, headers, credentials: 'same-origin' });
}
async function localMail(purpose: 'verification' | 'password-reset') {
  const response = await request(`/api/auth/local-outbox?email=${encodeURIComponent(email)}&purpose=${purpose}`);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.ok(body.simulated && body.messages.length > 0, `${purpose} message was captured by the simulated SMTP outbox`);
  return body.messages[0];
}
function tokenFromLink(link: string, parameter: 'verifyEmail' | 'resetPassword') {
  return new URL(link).searchParams.get(parameter) ?? '';
}
async function login(password: string) {
  const response = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  const jar = parseCookies(response);
  assert.ok(jar.sid && jar.csrf && body.csrfToken);
  return { body, jar };
}

const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
port = (portProbe.address() as any).port;
await new Promise<void>((resolveClose, reject) => portProbe.close(error => error ? reject(error) : resolveClose()));

try {
  child = spawn(process.execPath, [
    '--require', resolve(root, 'node_modules/tsx/dist/preflight.cjs'),
    '--import', pathToFileURL(resolve(root, 'node_modules/tsx/dist/loader.mjs')).href,
    resolve(root, 'server/src/index.ts'),
  ], { cwd: root, env: { ...process.env, APP_ENV: 'development', NODE_ENV: 'development', PROCESS_ROLE: 'web', PORT: String(port), HOST: '127.0.0.1', CLIENT_ORIGIN: originFor(), EMAIL_TRANSPORT: 'simulated', SYNC_SCHEDULER_ENABLED: 'false', ENRICHMENT_WORKER_ENABLED: 'false', ALERT_SCHEDULER_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Local auth test server exited during startup.');
    try { if ((await fetch(`${originFor()}/api/health`)).ok) { ready = true; break; } } catch { /* waiting for local startup */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  assert.ok(ready, 'local test server started');

  const register = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'QA', lastName: 'Lifecycle', email, password: originalPassword }) });
  assert.equal(register.status, 201);
  const registered = await register.json() as any;
  userId = Number(registered.userId);
  assert.ok(userId > 0 && registered.emailVerified === false);
  assert.equal(registered.emailDelivery, 'simulated');
  let jar = parseCookies(register);
  assert.ok(jar.sid && jar.csrf, 'registration creates a refreshable session');
  const pendingSession = await request('/api/auth/session', {}, jar);
  assert.equal((await pendingSession.json() as any).emailVerified, false, 'pending account status survives session refresh');
  const [createdUsers] = await pool.query<any[]>('SELECT id FROM app_users WHERE email_normalized=?', [email]);
  assert.equal(createdUsers.length, 1);
  const registrationMail = await localMail('verification');
  const expiredVerifyToken = tokenFromLink(registrationMail.link, 'verifyEmail');
  await pool.execute('UPDATE email_verification_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE token_hash=?', [createHash('sha256').update(expiredVerifyToken).digest()]);
  const expiredVerification = await request('/api/auth/email-verification/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: expiredVerifyToken }) });
  assert.equal(expiredVerification.status, 400, 'expired verification token is rejected');

  const pendingLogin = await login(originalPassword);
  assert.equal(pendingLogin.body.emailVerified, false, 'pending account can sign in to the verification gate');
  jar = pendingLogin.jar;
  const authenticatedResend = await request('/api/auth/email-verification/resend', { method: 'POST' }, jar);
  assert.equal(authenticatedResend.status, 202);
  assert.equal((await authenticatedResend.json() as any).delivery, 'simulated', 'signed-in pending account can resend and see that this was only simulated');
  const initialMail = await localMail('verification');
  const initialVerifyToken = tokenFromLink(initialMail.link, 'verifyEmail');
  assert.ok(initialVerifyToken.length >= 32);

  const duplicateRegister = await request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'QA', lastName: 'Lifecycle', email, password: originalPassword }) });
  assert.equal(duplicateRegister.status, 202, 'pending account is handled by resend, not duplicate registration');
  const duplicateBody = await duplicateRegister.json() as any;
  assert.equal(duplicateBody.emailVerificationRequired, true);
  assert.equal(Number((await pool.query<any[]>('SELECT COUNT(*) total FROM app_users WHERE email_normalized=?', [email]))[0][0].total), 1, 'registration retry does not create a duplicate user');

  const resend = await request('/api/auth/email-verification/resend-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  assert.equal(resend.status, 202);
  assert.match((await resend.json() as any).message, /Solicitud recibida/);
  const verificationMail = await localMail('verification');
  const verificationToken = tokenFromLink(verificationMail.link, 'verifyEmail');
  assert.notEqual(verificationToken, initialVerifyToken);
  const oldLink = await request('/api/auth/email-verification/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: initialVerifyToken }) });
  assert.equal(oldLink.status, 400, 'resending invalidates the earlier verification link');
  const verify = await request('/api/auth/email-verification/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }) });
  assert.equal(verify.status, 200);
  assert.equal((await request('/api/auth/session', {}, jar).then(r => r.json()) as any).emailVerified, true, 'existing session reads the newly verified database state after refresh');
  const replayVerify = await request('/api/auth/email-verification/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: verificationToken }) });
  assert.equal(replayVerify.status, 400, 'verification link is single use');
  assert.equal((await login(originalPassword)).body.emailVerified, true, 'verified account can sign in');

  const resetRequest = await request('/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  assert.equal(resetRequest.status, 202);
  assert.equal((await resetRequest.json() as any).accepted, true, 'reset request acceptance is not represented as confirmed email delivery');
  const firstResetMail = await localMail('password-reset');
  const expiredToken = tokenFromLink(firstResetMail.link, 'resetPassword');
  await pool.execute('UPDATE password_reset_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE token_hash=?', [createHash('sha256').update(expiredToken).digest()]);
  const expiredReset = await request('/api/auth/password-reset/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: expiredToken, password: recoveredPassword }) });
  assert.equal(expiredReset.status, 400, 'expired recovery token is rejected');

  const [sessionBeforeReset] = await Promise.all([login(originalPassword)]);
  const resetAgain = await request('/api/auth/password-reset/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  assert.equal(resetAgain.status, 202);
  const resetMail = await localMail('password-reset');
  const resetToken = tokenFromLink(resetMail.link, 'resetPassword');
  const completeReset = await request('/api/auth/password-reset/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: recoveredPassword }) });
  assert.equal(completeReset.status, 200);
  assert.equal((await request('/api/auth/session', {}, sessionBeforeReset.jar).then(r => r.json()) as any).authenticated, false, 'password recovery revokes existing sessions');
  const replayReset = await request('/api/auth/password-reset/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, password: changedPassword }) });
  assert.equal(replayReset.status, 400, 'recovery token is single use');

  const afterReset = await login(recoveredPassword);
  const change = await request('/api/auth/password/change', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: recoveredPassword, newPassword: changedPassword }) }, afterReset.jar);
  assert.equal(change.status, 200, 'signed-in password change succeeds');
  const refreshed = await request('/api/auth/session', {}, afterReset.jar);
  assert.equal((await refreshed.json() as any).authenticated, true, 'current session remains valid after change and page refresh');
  assert.equal((await login(changedPassword)).body.emailVerified, true, 'new password works after sign-in');

  assert.ok(!output.includes(originalPassword) && !output.includes(recoveredPassword) && !output.includes(verificationToken) && !output.includes(resetToken), 'test server output excludes passwords and tokens');
  console.log('PASS auth lifecycle (local simulated mail): registration, pending login/session refresh, expired verification, duplicate-safe resend, single-use verification, accepted reset request, expired/used reset tokens, password recovery/change, and session refresh.');
} catch (error) {
  console.error('FAIL auth lifecycle local integration:', error instanceof Error ? error.stack : 'unknown error');
  process.exitCode = 1;
} finally {
  if (child && !child.killed) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolveWait => setTimeout(resolveWait, 5000))]); }
  try {
    if (userId) await pool.execute('DELETE FROM app_users WHERE id=?', [userId]);
    else await pool.execute('DELETE FROM app_users WHERE email_normalized=?', [email]);
    const [left] = await pool.query<any[]>('SELECT COUNT(*) total FROM app_users WHERE email_normalized=?', [email]);
    assert.equal(Number(left[0].total), 0, 'only the temporary test account is removed');
    console.log('CLEANUP PASS: temporary auth account removed.');
  } catch (error) {
    console.error('CLEANUP FAIL:', error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  }
  await pool.end();
}
