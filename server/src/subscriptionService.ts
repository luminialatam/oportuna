import type { PoolConnection } from 'mysql2/promise';
import pool from './db.js';

export const planCatalog = {
  crece: { id: 'crece', name: 'Crece', priceClp: 0, annualPriceClp: 0, users: 1, analysesMonthly: 3, recommendationsWeekly: 5, trackedOpportunities: 10, marketAnalytics: false },
  vuela: { id: 'vuela', name: 'Vuela', priceClp: 49_900, annualPriceClp: 508_980, users: 3, analysesMonthly: 30, recommendationsWeekly: null, trackedOpportunities: null, marketAnalytics: true },
  brilla: { id: 'brilla', name: 'Brilla', priceClp: 79_900, annualPriceClp: 814_980, users: 5, analysesMonthly: 100, recommendationsWeekly: null, trackedOpportunities: null, marketAnalytics: true },
} as const;
export type PlanId = keyof typeof planCatalog;
export type BillingPeriod = 'monthly' | 'annual';

export class SubscriptionLimitError extends Error {
  readonly code = 'PLAN_LIMIT_REACHED';
  constructor(readonly metric: 'activeUsers' | 'trackedOpportunities' | 'analysesMonthly' | 'marketAnalytics', readonly limit: number, message: string) { super(message); }
}

export class PendingPlanRequestError extends Error {
  readonly code = 'PLAN_REQUEST_PENDING';
  constructor(message = 'Ya existe una solicitud de cambio de plan pendiente para esta empresa.') { super(message); }
}

export class PlanRequestConflictError extends Error {
  readonly code = 'PLAN_REQUEST_CONFLICT';
  constructor(message: string) { super(message); }
}

export function isPlanId(value: unknown): value is PlanId { return typeof value === 'string' && value in planCatalog; }

export async function getCompanyPlan(companyId: number, connection: Pick<PoolConnection, 'query'> = pool) {
  const [rows] = await connection.query<any[]>('SELECT plan FROM company_subscriptions WHERE company_id=? LIMIT 1', [companyId]);
  const plan = isPlanId(rows[0]?.plan) ? rows[0].plan as PlanId : 'crece';
  return planCatalog[plan];
}

export async function getCompanyPlanSummary(companyId: number) {
  const plan = await getCompanyPlan(companyId);
  const [[subscription], [users], [pending], [analyses], [tracked], [recommendations]] = await Promise.all([
    pool.query<any[]>('SELECT billing_period billingPeriod FROM company_subscriptions WHERE company_id=? LIMIT 1', [companyId]),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_memberships WHERE company_id=? AND status=\'active\'', [companyId]),
    pool.query<any[]>("SELECT COUNT(*) total FROM company_invitations WHERE company_id=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP()", [companyId]),
    pool.query<any[]>("SELECT COUNT(*) total FROM company_plan_analysis_usage WHERE company_id=? AND created_at>=DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-01')", [companyId]),
    pool.query<any[]>("SELECT COUNT(*) total FROM company_opportunity_tracking WHERE company_id=? AND estado<>'discarded'", [companyId]),
    pool.query<any[]>("SELECT COUNT(DISTINCT codigo_externo) total FROM company_user_opportunity_states WHERE company_id=? AND first_recommended_at>=DATE_SUB(UTC_DATE(),INTERVAL WEEKDAY(UTC_DATE()) DAY)", [companyId]),
  ]);
  return {
    plan,
    billingPeriod: subscription[0]?.billingPeriod === 'annual' ? 'annual' : 'monthly',
    usage: {
      activeUsers: Number(users[0]?.total ?? 0), pendingInvitations: Number(pending[0]?.total ?? 0),
      analysesMonthly: Number(analyses[0]?.total ?? 0), trackedOpportunities: Number(tracked[0]?.total ?? 0),
      recommendationsWeekly: Number(recommendations[0]?.total ?? 0),
    },
  };
}

export async function assertCanInviteMember(connection: PoolConnection, companyId: number) {
  const plan = await getCompanyPlan(companyId, connection);
  const [[active], [pending]] = await Promise.all([
    connection.query<any[]>('SELECT COUNT(*) total FROM company_memberships WHERE company_id=? AND status=\'active\'', [companyId]),
    connection.query<any[]>("SELECT COUNT(*) total FROM company_invitations WHERE company_id=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP()", [companyId]),
  ]);
  if (Number(active[0]?.total ?? 0) + Number(pending[0]?.total ?? 0) >= plan.users) {
    throw new SubscriptionLimitError('activeUsers', plan.users, `El plan ${plan.name} permite ${plan.users} usuario${plan.users === 1 ? '' : 's'} activo${plan.users === 1 ? '' : 's'}. Libera un cupo o cambia el plan.`);
  }
}

export async function assertCanActivateMember(connection: PoolConnection, companyId: number) {
  const plan = await getCompanyPlan(companyId, connection);
  const [[active]] = await connection.query<any[]>('SELECT COUNT(*) total FROM company_memberships WHERE company_id=? AND status=\'active\'', [companyId]);
  if (Number(active?.total ?? 0) >= plan.users) {
    throw new SubscriptionLimitError('activeUsers', plan.users, `El plan ${plan.name} ya alcanzó ${plan.users} usuario${plan.users === 1 ? '' : 's'} activo${plan.users === 1 ? '' : 's'}. Libera un cupo o cambia el plan.`);
  }
}

export async function assertCanTrackOpportunity(connection: PoolConnection, companyId: number) {
  const plan = await getCompanyPlan(companyId, connection);
  if (plan.trackedOpportunities === null) return;
  const [[tracked]] = await connection.query<any[]>("SELECT COUNT(*) total FROM company_opportunity_tracking WHERE company_id=? AND estado<>'discarded'", [companyId]);
  if (Number(tracked?.total ?? 0) >= plan.trackedOpportunities) {
    throw new SubscriptionLimitError('trackedOpportunities', plan.trackedOpportunities, `El plan ${plan.name} permite hasta ${plan.trackedOpportunities} oportunidades activas en Seguimiento. Descarta una o cambia el plan.`);
  }
}

export async function runLimitedListingAnalysis<T>(companyId: number, userId: number, code: string, run: () => Promise<T>) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [subscription] = await connection.query<any[]>('SELECT plan FROM company_subscriptions WHERE company_id=? FOR UPDATE', [companyId]);
    const planId: PlanId = isPlanId(subscription[0]?.plan) ? subscription[0].plan : 'crece';
    const plan = planCatalog[planId];
    const [[used]] = await connection.query<any[]>("SELECT COUNT(*) total FROM company_plan_analysis_usage WHERE company_id=? AND created_at>=DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-01')", [companyId]);
    if (Number(used?.total ?? 0) >= plan.analysesMonthly) {
      throw new SubscriptionLimitError('analysesMonthly', plan.analysesMonthly, `El plan ${plan.name} permite ${plan.analysesMonthly} análisis de fichas al mes. El cupo se renueva el próximo mes o puedes cambiar el plan.`);
    }
    const value = await run();
    await connection.execute('INSERT INTO company_plan_analysis_usage (company_id,user_id,codigo_externo) VALUES (?,?,?)', [companyId, userId, code]);
    await connection.commit();
    return { value, used: Number(used?.total ?? 0) + 1, limit: plan.analysesMonthly };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function applyCompanyPlan(connection: PoolConnection, companyId: number, plan: PlanId, changedBy: number, billingPeriod?: BillingPeriod) {
  const [companies] = await connection.query<any[]>('SELECT id FROM companies WHERE id=? FOR UPDATE', [companyId]);
  if (!companies.length) return false;
  await connection.execute("INSERT IGNORE INTO company_subscriptions (company_id,plan) VALUES (?,'crece')", [companyId]);
  await connection.query('SELECT company_id FROM company_subscriptions WHERE company_id=? FOR UPDATE', [companyId]);
  await connection.execute('UPDATE company_subscriptions SET plan=?,billing_period=COALESCE(?,billing_period),changed_by=? WHERE company_id=?', [plan, billingPeriod ?? null, changedBy, companyId]);
  return true;
}

export async function changeCompanyPlan(companyId: number, plan: PlanId, adminUserId: number, billingPeriod?: BillingPeriod) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const changed = await applyCompanyPlan(connection, companyId, plan, adminUserId, billingPeriod);
    await connection.commit();
    return changed;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function requestCompanyPlanChange(companyId: number, requestedBy: number, plan: PlanId, billingPeriod: BillingPeriod) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [companies] = await connection.query<any[]>('SELECT id FROM companies WHERE id=? FOR UPDATE', [companyId]);
    if (!companies.length) { await connection.rollback(); throw new PlanRequestConflictError('No se encontró la empresa activa.'); }
    await connection.execute("INSERT IGNORE INTO company_subscriptions (company_id,plan) VALUES (?,'crece')", [companyId]);
    const [subscription] = await connection.query<any[]>('SELECT plan,billing_period FROM company_subscriptions WHERE company_id=? FOR UPDATE', [companyId]);
    const currentPlan = isPlanId(subscription[0]?.plan) ? subscription[0].plan : 'crece';
    const currentPeriod: BillingPeriod = subscription[0]?.billing_period === 'annual' ? 'annual' : 'monthly';
    if (currentPlan === plan && currentPeriod === billingPeriod) throw new PlanRequestConflictError('La empresa ya tiene activo ese plan y modalidad.');
    const [pending] = await connection.query<any[]>('SELECT id FROM company_plan_change_requests WHERE company_id=? AND status=\'pending\' LIMIT 1 FOR UPDATE', [companyId]);
    if (pending.length) throw new PendingPlanRequestError();
    const [insert] = await connection.execute<any>('INSERT INTO company_plan_change_requests (company_id,requested_by,requested_plan,billing_period) VALUES (?,?,?,?)', [companyId, requestedBy, plan, billingPeriod]);
    await connection.commit();
    return Number(insert.insertId);
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function listCompanyPlanRequests(companyId: number) {
  const [rows] = await pool.query<any[]>(`SELECT r.id,r.requested_plan requestedPlan,r.billing_period billingPeriod,r.status,r.requested_at requestedAt,
    r.reviewed_at reviewedAt,r.decision_note decisionNote,reviewer.first_name reviewerFirstName,reviewer.last_name reviewerLastName
    FROM company_plan_change_requests r LEFT JOIN app_users reviewer ON reviewer.id=r.reviewed_by
    WHERE r.company_id=? ORDER BY r.requested_at DESC LIMIT 20`, [companyId]);
  return rows.map(row => ({ ...row, id: Number(row.id) }));
}

export async function listPendingCompanyPlanRequests() {
  const [rows] = await pool.query<any[]>(`SELECT r.id,r.company_id companyId,c.nombre_comercial companyName,r.requested_plan requestedPlan,
    r.billing_period billingPeriod,r.requested_at requestedAt,u.first_name requesterFirstName,u.last_name requesterLastName
    FROM company_plan_change_requests r JOIN companies c ON c.id=r.company_id JOIN app_users u ON u.id=r.requested_by
    WHERE r.status='pending' ORDER BY r.requested_at,r.id`);
  return rows.map(row => ({ ...row, id: Number(row.id), companyId: Number(row.companyId) }));
}

export async function reviewCompanyPlanRequest(requestId: number, decision: 'approved' | 'rejected', reviewedBy: number, note: string | null = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<any[]>(`SELECT id,company_id,requested_plan,billing_period FROM company_plan_change_requests
      WHERE id=? AND status='pending' LIMIT 1 FOR UPDATE`, [requestId]);
    const request = rows[0];
    if (!request) { await connection.rollback(); return null; }
    if (decision === 'approved') {
      const plan: PlanId = isPlanId(request.requested_plan) ? request.requested_plan : 'crece';
      const period: BillingPeriod = request.billing_period === 'annual' ? 'annual' : 'monthly';
      await applyCompanyPlan(connection, Number(request.company_id), plan, reviewedBy, period);
    }
    await connection.execute('UPDATE company_plan_change_requests SET status=?,reviewed_by=?,reviewed_at=UTC_TIMESTAMP(),decision_note=? WHERE id=? AND status=\'pending\'', [decision, reviewedBy, note, requestId]);
    await connection.commit();
    return { id: requestId, companyId: Number(request.company_id), plan: request.requested_plan, billingPeriod: request.billing_period, status: decision };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function listCompanySubscriptions() {
  const [rows] = await pool.query<any[]>(`SELECT c.id companyId,c.nombre_comercial companyName,COALESCE(s.plan,'crece') plan,COALESCE(s.billing_period,'monthly') billingPeriod,
    (SELECT COUNT(*) FROM company_memberships m WHERE m.company_id=c.id AND m.status='active') activeUsers,
    (SELECT COUNT(*) FROM company_opportunity_tracking t WHERE t.company_id=c.id AND t.estado<>'discarded') trackedOpportunities
    FROM companies c LEFT JOIN company_subscriptions s ON s.company_id=c.id ORDER BY c.nombre_comercial,c.id`);
  return rows.map(row => ({ ...row, companyId: Number(row.companyId), activeUsers: Number(row.activeUsers), trackedOpportunities: Number(row.trackedOpportunities) }));
}
