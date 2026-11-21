import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { createSession, createUser, revokeSession } from '../src/authService.js';
import { csrfCookieName, sessionCookieName } from '../src/authMiddleware.js';
import { changeCompanyPlan } from '../src/subscriptionService.js';

const dbHost = String(process.env.DB_HOST ?? '127.0.0.1');
assert(['localhost', '127.0.0.1', '::1'].includes(dbHost), 'Refusing API test: DB host must be loopback.');
const marker = `QA TEMP API ${randomUUID()}`;
const baseUrl = 'http://127.0.0.1:4000';
const origin = 'http://127.0.0.1:5180';
let userId = 0;
let companyId = 0;
let sessionRaw = '';
try {
  const [[database]] = await pool.query<any[]>('SELECT DATABASE() name');
  assert.equal(database.name, 'oportuna', 'Refusing API test: unexpected database.');
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200, 'The local API must be online.');
  assert.equal((await health.json() as any).mysql, true, 'The local API must have MySQL.');
  const [listings] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones ORDER BY codigo_externo LIMIT 11');
  assert.equal(listings.length, 11, 'Eleven local indexed listings are required.');

  userId = await createUser(`qa+${randomUUID()}@example.invalid`, 'Local-only-qa-password-012345', 'user', 'QA', 'Temporal');
  const [company] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [marker]);
  companyId = Number(company.insertId);
  await pool.execute("INSERT INTO company_subscriptions (company_id,plan) VALUES (?,'crece')", [companyId]);
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')", [userId, companyId]);
  for (const listing of listings.slice(0, 10)) await pool.execute('INSERT INTO company_opportunity_tracking (company_id,codigo_externo) VALUES (?,?)', [companyId, listing.codigo_externo]);

  const session = await createSession(userId, companyId);
  sessionRaw = session.raw;
  const cookie = `${sessionCookieName}=${encodeURIComponent(session.raw)}; ${csrfCookieName}=${encodeURIComponent(session.csrf)}`;
  const call = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}${path}`, {
    method,
    headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': session.csrf, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const planResponse = await call('/api/company/plan');
  assert.equal(planResponse.status, 200);
  assert.equal((await planResponse.json() as any).plan.id, 'crece');
  const limitedTracking = await call('/api/company/tracking', 'POST', { codigo: String(listings[10].codigo_externo) });
  assert.equal(limitedTracking.status, 403, 'The API must block tracking past Crece cap.');
  assert.equal((await limitedTracking.json() as any).metric, 'trackedOpportunities');
  const limitedAnalytics = await call('/api/company/analytics/top-buyers');
  assert.equal(limitedAnalytics.status, 403, 'Crece must not access market analytics.');
  assert.equal((await limitedAnalytics.json() as any).code, 'PLAN_UPGRADE_REQUIRED');
  await changeCompanyPlan(companyId, 'vuela', userId);
  const premiumAnalytics = await call('/api/company/analytics/top-buyers');
  assert.equal(premiumAnalytics.status, 200, 'Vuela must access indexed buyer analytics.');
  const analyticsData = await premiumAnalytics.json() as any;
  assert.equal(analyticsData.periodDays, 30);
  assert(analyticsData.buyers.length <= 5);
  await changeCompanyPlan(companyId, 'crece', userId);

  await pool.execute("UPDATE company_memberships SET role='read_only' WHERE user_id=? AND company_id=?", [userId, companyId]);
  const deniedWrite = await call('/api/company/tracking', 'POST', { codigo: String(listings[10].codigo_externo) });
  assert.equal(deniedWrite.status, 403, 'Read-only company members must not add tracked opportunities.');
  const deniedPlanChange = await call(`/api/platform/companies/${companyId}/plan`, 'PATCH', { plan: 'vuela' });
  assert.equal(deniedPlanChange.status, 403, 'A client cannot change a company plan.');
  console.log('Local API checks passed: authenticated plan, tracking cap, analytics gate, read-only permissions, and platform plan-change authorization.');
} finally {
  if (sessionRaw) await revokeSession(sessionRaw);
  if (companyId) await pool.execute('DELETE FROM companies WHERE id=? AND nombre_comercial=?', [companyId, marker]);
  if (userId) await pool.execute('DELETE FROM app_users WHERE id=?', [userId]);
  if (companyId) {
    const [[remaining]] = await pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE id=? AND nombre_comercial=?', [companyId, marker]);
    assert.equal(Number(remaining.total), 0, 'Temporary API company cleanup must complete.');
  }
  if (userId) {
    const [[remaining]] = await pool.query<any[]>('SELECT COUNT(*) total FROM app_users WHERE id=?', [userId]);
    assert.equal(Number(remaining.total), 0, 'Temporary API user cleanup must complete.');
  }
  await pool.end();
}
