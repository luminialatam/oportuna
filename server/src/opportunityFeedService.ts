import pool from './db.js';
import { currentCompanyContext } from './companyRequestContext.js';
import { getCompanyMatches } from './companyService.js';
import { planCatalog, isPlanId, type PlanId } from './subscriptionService.js';
import { getOpportunityTeam, recordCompanyActivity, saveOpportunityTeam } from './collaborationService.js';

export type OpportunityFeedFilter = 'recommended' | 'unread' | 'discarded';
type ListingCode = { codigo_externo: string };

export function preserveMatchOrder<T extends ListingCode>(orderedMatches: T[], visibleCodes: ReadonlySet<string>): T[] {
  const seen = new Set<string>();
  return orderedMatches.filter(item => {
    const code = String(item.codigo_externo);
    if (!visibleCodes.has(code) || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

function currentContext() {
  const context = currentCompanyContext();
  if (!context?.userId || !context.companyId) throw new Error('Selecciona una empresa activa.');
  return { userId: context.userId, companyId: context.companyId };
}

export async function getOpportunityFeed(filter: OpportunityFeedFilter) {
  const { userId, companyId } = currentContext();
  if (filter === 'discarded') {
    const [rows] = await pool.query<any[]>(`SELECT l.codigo_externo,l.nombre,l.codigo_estado,l.fecha_cierre,l.organismo,l.monto_estimado,l.moneda,
      s.read_at readAt,s.dismissed_at dismissedAt,s.first_recommended_at firstRecommendedAt
      FROM company_user_opportunity_states s JOIN licitaciones l ON l.codigo_externo=s.codigo_externo
      WHERE s.company_id=? AND s.user_id=? AND s.dismissed_at IS NOT NULL
      ORDER BY s.dismissed_at DESC LIMIT 200`, [companyId, userId]);
    return { configured: true, total: rows.length, high: 0, medium: 0, closingSoon: 0, items: rows.map(row => ({ ...row, score: 0, level: 'discarded' })) };
  }

  const matches = await getCompanyMatches({ includeAllItems: true });
  if (!matches.configured) return { ...matches, items: [] };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Serializes weekly recommendation assignment and plan changes for this company.
    let [subscription] = await connection.query<any[]>('SELECT plan FROM company_subscriptions WHERE company_id=? FOR UPDATE', [companyId]);
    if (!subscription.length) {
      await connection.execute("INSERT IGNORE INTO company_subscriptions (company_id,plan) VALUES (?,'crece')", [companyId]);
      [subscription] = await connection.query<any[]>('SELECT plan FROM company_subscriptions WHERE company_id=? FOR UPDATE', [companyId]);
    }
    const planId: PlanId = isPlanId(subscription[0]?.plan) ? subscription[0].plan as PlanId : 'crece';
    const plan = planCatalog[planId];
    const [alreadyShownRows] = await connection.query<any[]>(`SELECT DISTINCT codigo_externo FROM company_user_opportunity_states
      WHERE company_id=? AND first_recommended_at>=DATE_SUB(UTC_DATE(),INTERVAL WEEKDAY(UTC_DATE()) DAY)`, [companyId]);
    const alreadyShown = new Set<string>(alreadyShownRows.map(row => String(row.codigo_externo)));
    const [userStates] = await connection.query<any[]>(`SELECT codigo_externo,read_at readAt,dismissed_at dismissedAt,first_recommended_at firstRecommendedAt
      FROM company_user_opportunity_states WHERE company_id=? AND user_id=?`, [companyId, userId]);
    const stateByCode = new Map<string, any>(userStates.map(row => [String(row.codigo_externo), row]));
    const maxWeekly = plan.recommendationsWeekly;
    const eligible = matches.items.filter((item: any) => !stateByCode.get(String(item.codigo_externo))?.dismissedAt);
    const remaining = maxWeekly === null ? eligible.length : Math.max(0, maxWeekly - alreadyShown.size);
    const shownThisWeek = eligible.filter((item: any) => alreadyShown.has(String(item.codigo_externo)));
    const newCandidates = eligible.filter((item: any) => !alreadyShown.has(String(item.codigo_externo)));
    const newlyShown = newCandidates.slice(0, remaining);
    const visible = [...shownThisWeek, ...newlyShown];
    for (const item of visible) {
      await connection.execute(`INSERT INTO company_user_opportunity_states (company_id,user_id,codigo_externo,first_recommended_at)
        VALUES (?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE
        first_recommended_at=IF(first_recommended_at IS NULL OR first_recommended_at<DATE_SUB(UTC_DATE(),INTERVAL WEEKDAY(UTC_DATE()) DAY),UTC_TIMESTAMP(),first_recommended_at)`,
      [companyId, userId, item.codigo_externo]);
    }
    const codes = visible.map((item: any) => String(item.codigo_externo));
    const statesByCode = new Map<string, any>();
    if (codes.length) {
      const [states] = await connection.query<any[]>(`SELECT codigo_externo,read_at readAt,dismissed_at dismissedAt,first_recommended_at firstRecommendedAt
        FROM company_user_opportunity_states WHERE company_id=? AND user_id=? AND codigo_externo IN (${codes.map(() => '?').join(',')})`, [companyId, userId, ...codes]);
      for (const state of states) statesByCode.set(String(state.codigo_externo), state);
    }
    await connection.commit();
    const visibleCodes = new Set(visible.map((item: any) => String(item.codigo_externo)));
    // Keep the scoring engine's global relevance ordering while preserving the weekly quota.
    const globallyOrderedVisible = preserveMatchOrder(eligible, visibleCodes);
    const trackingByCode = new Map<string, any>();
    if (codes.length) {
      const [trackedRows] = await connection.query<any[]>(`SELECT codigo_externo,created_at trackingCreatedAt,estado trackingState
        FROM company_opportunity_tracking WHERE company_id=? AND codigo_externo IN (${codes.map(() => '?').join(',')})`, [companyId, ...codes]);
      for (const tracked of trackedRows) trackingByCode.set(String(tracked.codigo_externo), tracked);
    }
    const items = globallyOrderedVisible.map((item: any) => ({ ...item, ...(statesByCode.get(String(item.codigo_externo)) ?? {}), ...(trackingByCode.get(String(item.codigo_externo)) ?? {}) }))
      .filter((item: any) => !item.dismissedAt && (filter !== 'unread' || !item.readAt));
    return { ...matches, total: items.length, items };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function markOpportunityRead(code: string) {
  const { userId, companyId } = currentContext();
  const [listings] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1', [code]);
  if (!listings.length) return false;
  const [result] = await pool.execute<any>(`INSERT INTO company_user_opportunity_states (company_id,user_id,codigo_externo,read_at)
    VALUES (?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE read_at=COALESCE(read_at,UTC_TIMESTAMP())`, [companyId, userId, code]);
  if (Number(result.affectedRows) > 0) await recordCompanyActivity(code, 'marked_read', 'Se marcó la oportunidad como leída.');
  return true;
}

export async function dismissOpportunity(code: string) {
  const { userId, companyId } = currentContext();
  const [listings] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1', [code]);
  if (!listings.length) return false;
  const [result] = await pool.execute<any>(`INSERT INTO company_user_opportunity_states (company_id,user_id,codigo_externo,dismissed_at)
    VALUES (?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE dismissed_at=UTC_TIMESTAMP()`, [companyId, userId, code]);
  if (Number(result.affectedRows) > 0) await recordCompanyActivity(code, 'opportunity_discarded', 'Se descartó la oportunidad.');
  return true;
}

export async function restoreOpportunity(code: string) {
  const { userId, companyId } = currentContext();
  const [result] = await pool.execute<any>('UPDATE company_user_opportunity_states SET dismissed_at=NULL WHERE company_id=? AND user_id=? AND codigo_externo=? AND dismissed_at IS NOT NULL', [companyId, userId, code]);
  if (Number(result.affectedRows) > 0) await recordCompanyActivity(code, 'opportunity_restored', 'Se recuperó la oportunidad descartada.');
  return Number(result.affectedRows) > 0;
}

export async function bulkOpportunityAction(input: { codes: string[]; action: 'read' | 'discard' | 'restore' | 'assign'; assignedUserId?: number | null }) {
  const results: Array<{ code: string; ok: boolean; error?: string }> = [];
  for (const code of input.codes) {
    try {
      let ok = false;
      if (input.action === 'read') ok = await markOpportunityRead(code);
      else if (input.action === 'discard') ok = await dismissOpportunity(code);
      else if (input.action === 'restore') ok = await restoreOpportunity(code);
      else {
        const team = await getOpportunityTeam(code);
        const saved = await saveOpportunityTeam(code, { assignedUserId: input.assignedUserId ?? null, participantIds: team.participants.map(person => person.id) });
        ok = saved !== null;
      }
      results.push(ok ? { code, ok } : { code, ok: false, error: 'La oportunidad no está disponible o el estado ya cambió.' });
    } catch (error) { results.push({ code, ok: false, error: error instanceof Error ? error.message : 'No se pudo aplicar la acción.' }); }
  }
  return { action: input.action, total: results.length, succeeded: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, results };
}
