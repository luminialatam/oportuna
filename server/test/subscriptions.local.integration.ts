import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { assertCanActivateMember, assertCanInviteMember, assertCanTrackOpportunity, changeCompanyPlan, getCompanyPlan, getCompanyPlanSummary, runLimitedListingAnalysis, SubscriptionLimitError } from '../src/subscriptionService.js';
import { saveTrackedOpportunity } from '../src/trackingService.js';
import { dismissOpportunity, markOpportunityRead, restoreOpportunity } from '../src/opportunityFeedService.js';

const configuredHost = String(process.env.DB_HOST ?? '127.0.0.1');
assert(['localhost', '127.0.0.1', '::1'].includes(configuredHost), 'Refusing test: DB host must be loopback.');

const marker = `QA TEMP subscription ${randomUUID()}`;
let companyId = 0;
try {
  const [[database]] = await pool.query<any[]>('SELECT DATABASE() name');
  assert.equal(database.name, 'oportuna', 'Refusing test: unexpected database.');
  const [[users]] = await pool.query<any[]>('SELECT id FROM app_users ORDER BY id LIMIT 1');
  assert(users?.id, 'A local user is needed to exercise the membership and analysis limits.');
  const [listings] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones ORDER BY codigo_externo LIMIT 12');
  assert.equal(listings.length, 12, 'Twelve indexed local listings are needed for quota checks.');

  const connection = await pool.getConnection();
  try {
    const [company] = await connection.execute<any>("INSERT INTO companies (nombre_comercial) VALUES (?)", [marker]);
    companyId = Number(company.insertId);
    await connection.execute("INSERT INTO company_subscriptions (company_id,plan) VALUES (?,'crece')", [companyId]);
    await connection.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')", [Number(users.id), companyId]);
    for (const listing of listings.slice(0, 10)) await connection.execute('INSERT INTO company_opportunity_tracking (company_id,codigo_externo) VALUES (?,?)', [companyId, listing.codigo_externo]);
  } finally { connection.release(); }

  const inviteConnection = await pool.getConnection();
  try {
    const [[membershipCount]] = await inviteConnection.query<any[]>('SELECT COUNT(*) total FROM company_memberships WHERE company_id=? AND status=\'active\'', [companyId]);
    assert.equal(Number(membershipCount?.total), 1);
    await assert.rejects(() => assertCanInviteMember(inviteConnection, companyId), (error: unknown) => error instanceof SubscriptionLimitError && error.metric === 'activeUsers');
    await assert.rejects(() => assertCanActivateMember(inviteConnection, companyId), (error: unknown) => error instanceof SubscriptionLimitError && error.metric === 'activeUsers');
  } finally { inviteConnection.release(); }
  const initialUsage = await getCompanyPlanSummary(companyId);
  assert.deepEqual(initialUsage.usage, { activeUsers: 1, pendingInvitations: 0, analysesMonthly: 0, trackedOpportunities: 10, recommendationsWeekly: 0 });

  const quotaConnection = await pool.getConnection();
  try {
    const [[tracked]] = await quotaConnection.query<any[]>('SELECT COUNT(*) total FROM company_opportunity_tracking WHERE company_id=?', [companyId]);
    assert.equal(Number(tracked.total), 10);
    assert.equal((await getCompanyPlan(companyId, quotaConnection)).trackedOpportunities, 10);
    await assert.rejects(() => assertCanTrackOpportunity(quotaConnection, companyId), (error: unknown) => error instanceof SubscriptionLimitError && error.metric === 'trackedOpportunities');
  } finally { quotaConnection.release(); }
  await assert.rejects(
    () => runWithCompanyContext({ userId: Number(users.id), companyId, role: 'admin', platformRole: 'user' }, () => saveTrackedOpportunity(String(listings[10].codigo_externo))),
    (error: unknown) => error instanceof SubscriptionLimitError && error.metric === 'trackedOpportunities',
  );
  assert.equal(await changeCompanyPlan(companyId, 'vuela', Number(users.id)), true);
  const created = await runWithCompanyContext({ userId: Number(users.id), companyId, role: 'admin', platformRole: 'user' }, () => saveTrackedOpportunity(String(listings[10].codigo_externo)));
  assert.equal(created?.created, true, 'Vuela must allow tracking beyond Crece limit.');
  assert.equal(await changeCompanyPlan(companyId, 'crece', Number(users.id)), true);
  const [[preserved]] = await pool.query<any[]>('SELECT COUNT(*) total FROM company_opportunity_tracking WHERE company_id=?', [companyId]);
  assert.equal(Number(preserved.total), 11, 'Downgrading must preserve tracked items.');
  await assert.rejects(
    () => runWithCompanyContext({ userId: Number(users.id), companyId, role: 'admin', platformRole: 'user' }, () => saveTrackedOpportunity(String(listings[11].codigo_externo))),
    (error: unknown) => error instanceof SubscriptionLimitError && error.metric === 'trackedOpportunities',
  );

  for (let index = 0; index < 3; index += 1) {
    const result = await runLimitedListingAnalysis(companyId, Number(users.id), String(listings[0].codigo_externo), async () => ({ ok: true }));
    assert.equal(result.used, index + 1);
  }
  await assert.rejects(
    () => runLimitedListingAnalysis(companyId, Number(users.id), String(listings[0].codigo_externo), async () => ({ ok: true })),
    (error: unknown) => error instanceof SubscriptionLimitError && error.metric === 'analysesMonthly',
  );
  const context = { userId: Number(users.id), companyId, role: 'admin' as const, platformRole: 'user' as const };
  await runWithCompanyContext(context, () => markOpportunityRead(String(listings[0].codigo_externo)));
  assert.equal(await runWithCompanyContext(context, () => dismissOpportunity(String(listings[1].codigo_externo))), true);
  assert.equal(await runWithCompanyContext(context, () => restoreOpportunity(String(listings[1].codigo_externo))), true);
  const [[stateCounts]] = await pool.query<any[]>('SELECT SUM(read_at IS NOT NULL) readCount,SUM(dismissed_at IS NOT NULL) dismissedCount FROM company_user_opportunity_states WHERE company_id=? AND user_id=?', [companyId, Number(users.id)]);
  assert.equal(Number(stateCounts.readCount), 1);
  assert.equal(Number(stateCounts.dismissedCount), 0);
  console.log('Local subscription checks passed: user seats, track cap, downgrade preservation, and monthly analyses.');
} finally {
  if (companyId) {
    await pool.execute('DELETE FROM companies WHERE id=? AND nombre_comercial=?', [companyId, marker]);
    const [[remaining]] = await pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE id=? AND nombre_comercial=?', [companyId, marker]);
    assert.equal(Number(remaining.total), 0, 'Temporary company cleanup must complete.');
  }
  await pool.end();
}
