import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { createSession, createUser, revokeSession } from '../src/authService.js';
import { csrfCookieName, sessionCookieName } from '../src/authMiddleware.js';
import { assertCanActivateMember, assertCanInviteMember } from '../src/subscriptionService.js';

const dbHost = String(process.env.DB_HOST ?? '127.0.0.1');
assert(['localhost', '127.0.0.1', '::1'].includes(dbHost), 'Refusing API test: DB host must be loopback.');
const marker = `QA TEMP plan request ${randomUUID()}`;
const baseUrl = 'http://127.0.0.1:4000';
const origin = 'http://127.0.0.1:5180';
let companyId = 0;
const userIds: number[] = [];
const sessionTokens: string[] = [];

try {
  const [[database]] = await pool.query<any[]>('SELECT DATABASE() name');
  assert.equal(database.name, 'oportuna', 'Refusing API test: unexpected database.');
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200, 'The local API must be online.');
  assert.equal((await health.json() as any).mysql, true, 'The local API must have MySQL.');

  const requesterId = await createUser(`qa+requester-${randomUUID()}@example.invalid`, 'Local-only-qa-password-012345', 'user', 'QA', 'Requester');
  userIds.push(requesterId);
  const platformAdminId = await createUser(`qa+platform-${randomUUID()}@example.invalid`, 'Local-only-qa-password-012345', 'admin', 'QA', 'Platform');
  userIds.push(platformAdminId);
  const [company] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [marker]);
  companyId = Number(company.insertId);
  await pool.execute("INSERT INTO company_subscriptions (company_id,plan) VALUES (?,'crece')", [companyId]);
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')", [requesterId, companyId]);

  const requesterSession = await createSession(requesterId, companyId);
  const platformSession = await createSession(platformAdminId);
  sessionTokens.push(requesterSession.raw, platformSession.raw);
  const call = (path: string, session: typeof requesterSession, method = 'GET', body?: unknown) => {
    const cookie = `${sessionCookieName}=${encodeURIComponent(session.raw)}; ${csrfCookieName}=${encodeURIComponent(session.csrf)}`;
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': session.csrf, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  };

  const requestResponse = await call('/api/company/plan-requests', requesterSession, 'POST', { plan: 'vuela', billingPeriod: 'annual' });
  assert.equal(requestResponse.status, 201, 'Company admins must be able to submit annual plan requests.');
  const request = await requestResponse.json() as { id: number; status: string };
  assert.equal(request.status, 'pending');

  const duplicate = await call('/api/company/plan-requests', requesterSession, 'POST', { plan: 'vuela', billingPeriod: 'annual' });
  assert.equal(duplicate.status, 409, 'A company must not create a second pending request.');
  assert.equal((await duplicate.json() as any).code, 'PLAN_REQUEST_PENDING');

  const forbiddenQueue = await call('/api/platform/plan-requests', requesterSession);
  assert.equal(forbiddenQueue.status, 403, 'Company admins must not access the platform review queue.');
  const queue = await call('/api/platform/plan-requests', platformSession);
  assert.equal(queue.status, 200, 'Platform admins must see the request queue.');
  const queueData = await queue.json() as { requests: Array<{ id: number; companyId: number; requestedPlan: string; billingPeriod: string }> };
  const queuedRequest = queueData.requests.find(item => item.id === request.id);
  assert(queuedRequest, 'The annual request must appear in the platform queue.');
  assert.equal(queuedRequest.companyId, companyId);
  assert.equal(queuedRequest.requestedPlan, 'vuela');
  assert.equal(queuedRequest.billingPeriod, 'annual');

  const approval = await call(`/api/platform/plan-requests/${request.id}`, platformSession, 'PATCH', { decision: 'approved' });
  assert.equal(approval.status, 200, 'A platform admin must be able to approve the request.');
  assert.equal((await approval.json() as any).request.status, 'approved');
  const summaryResponse = await call('/api/company/plan', requesterSession);
  assert.equal(summaryResponse.status, 200);
  const summary = await summaryResponse.json() as any;
  assert.equal(summary.plan.id, 'vuela');
  assert.equal(summary.billingPeriod, 'annual');
  assert.equal(summary.plan.users, 3, 'The approved plan must apply its user cap.');

  const rejectionRequestResponse = await call('/api/company/plan-requests', requesterSession, 'POST', { plan: 'brilla', billingPeriod: 'monthly' });
  assert.equal(rejectionRequestResponse.status, 201, 'A new request is allowed after the previous one is resolved.');
  const rejectionRequest = await rejectionRequestResponse.json() as { id: number };
  const rejection = await call(`/api/platform/plan-requests/${rejectionRequest.id}`, platformSession, 'PATCH', { decision: 'rejected', note: 'Revisión QA local' });
  assert.equal(rejection.status, 200);
  assert.equal((await rejection.json() as any).request.status, 'rejected');

  const additionalIds: number[] = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const id = await createUser(`qa+member-${index}-${randomUUID()}@example.invalid`, 'Local-only-qa-password-012345', 'user', 'QA', 'Member');
      additionalIds.push(id); userIds.push(id);
      await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'collaborator','active')", [id, companyId]);
    }
    const connection = await pool.getConnection();
    try {
      await assert.rejects(() => assertCanInviteMember(connection, companyId), /permite 3 usuarios activos/);
      await assert.rejects(() => assertCanActivateMember(connection, companyId), /alcanzó 3 usuarios activos/);
    } finally { connection.release(); }
  } finally {
    void additionalIds;
  }

  const history = await call('/api/company/plan-requests', requesterSession);
  const historyData = await history.json() as { requests: Array<{ id: number; status: string; reviewedAt: string | null; reviewerFirstName: string | null; decisionNote: string | null }> };
  const reviewed = historyData.requests.find(item => item.id === request.id);
  const rejected = historyData.requests.find(item => item.id === rejectionRequest.id);
  assert.equal(reviewed?.status, 'approved');
  assert(reviewed?.reviewedAt, 'Approval time must be recorded.');
  assert.equal(reviewed?.reviewerFirstName, 'QA', 'Reviewer identity must be recorded.');
  assert.equal(rejected?.status, 'rejected');
  assert.equal(rejected?.decisionNote, 'Revisión QA local');
  console.log('Local API checks passed: annual request, authorized platform queue, approval and rejection audit, duplicate prevention, reviewer audit, and the approved 3-user cap.');
} finally {
  for (const raw of sessionTokens) await revokeSession(raw);
  if (companyId) await pool.execute('DELETE FROM companies WHERE id=? AND nombre_comercial=?', [companyId, marker]);
  for (const userId of userIds) await pool.execute('DELETE FROM app_users WHERE id=?', [userId]);
  if (companyId) {
    const [[remaining]] = await pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE id=? AND nombre_comercial=?', [companyId, marker]);
    assert.equal(Number(remaining.total), 0, 'Temporary API company cleanup must complete.');
  }
  for (const userId of userIds) {
    const [[remaining]] = await pool.query<any[]>('SELECT COUNT(*) total FROM app_users WHERE id=?', [userId]);
    assert.equal(Number(remaining.total), 0, 'Temporary API user cleanup must complete.');
  }
  await pool.end();
}
