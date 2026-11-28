import pool from './db.js';
import { currentCompanyContext, runWithCompanyContext } from './companyRequestContext.js';
import { addTrackedDate, saveTrackedOpportunity } from './trackingService.js';
import { getOpportunityTeam, saveOpportunityTeam } from './collaborationService.js';
import { loadRuntimeConfig } from './runtimeConfig.js';
import { automationCandidateMatches, type AutomationCandidate, type AutomationConditions, type AutomationTrigger } from './automationConditions.js';

export type AutomationActions = { createTask: boolean; taskLabel: string; taskDueDays: number; assignUserId: number | null; notify: boolean };
const parseJson = <T>(value: unknown, fallback: T): T => { try { return (typeof value === 'string' ? JSON.parse(value) : value) as T ?? fallback; } catch { return fallback; } };
const currentScope = () => { const context = currentCompanyContext(); if (!context?.companyId || !context.userId) throw new Error('Selecciona una empresa activa.'); return { companyId: context.companyId, userId: context.userId }; };

export async function listAutomationRules() {
  const { companyId } = currentScope();
  const [rows] = await pool.query<any[]>(`SELECT r.id,r.name,r.trigger_type triggerType,r.conditions_json conditions,r.actions_json actions,r.enabled,r.last_run_at lastRunAt,r.last_error lastError,r.created_at createdAt,
    (SELECT status FROM company_automation_runs x WHERE x.company_id=r.company_id AND x.rule_id=r.id ORDER BY x.started_at DESC,x.id DESC LIMIT 1) lastRunStatus,
    (SELECT error_summary FROM company_automation_runs x WHERE x.company_id=r.company_id AND x.rule_id=r.id ORDER BY x.started_at DESC,x.id DESC LIMIT 1) lastRunError
    FROM company_automation_rules r WHERE r.company_id=? ORDER BY r.updated_at DESC,r.id DESC`, [companyId]);
  return rows.map(row => ({ id: Number(row.id), name: row.name, triggerType: row.triggerType as AutomationTrigger, conditions: parseJson<AutomationConditions>(row.conditions, {}), actions: parseJson<AutomationActions>(row.actions, { createTask: false, taskLabel: '', taskDueDays: 1, assignUserId: null, notify: false }), enabled: Boolean(row.enabled), lastRunAt: row.lastRunAt, lastError: row.lastError ?? row.lastRunError ?? null, lastRunStatus: row.lastRunStatus ?? null, createdAt: row.createdAt }));
}

export function automationSchedulerStatus() {
  const runtime = loadRuntimeConfig();
  const internal = ['all', 'alert-worker'].includes(runtime.processRole) && runtime.alertSchedulerEnabled;
  const external = runtime.appEnv === 'production' && runtime.processRole === 'web' && Boolean(process.env.SYNC_API_TOKEN?.trim());
  return { enabled: internal || external, runner: internal ? 'worker' : external ? 'GitHub Actions' : null, cadenceMinutes: 5, timezone: 'America/Santiago' };
}

export async function saveAutomationRule(input: { id?: number; name: string; triggerType: AutomationTrigger; conditions: AutomationConditions; actions: AutomationActions }) {
  const { companyId, userId } = currentScope();
  if (input.actions.assignUserId != null) {
    const [rows] = await pool.query<any[]>("SELECT user_id FROM company_memberships WHERE company_id=? AND user_id=? AND status='active'", [companyId, input.actions.assignUserId]);
    if (!rows.length) throw new Error('La persona asignada no pertenece a la empresa activa.');
  }
  if (input.id) {
    const [owned] = await pool.query<any[]>('SELECT id FROM company_automation_rules WHERE id=? AND company_id=? LIMIT 1', [input.id, companyId]);
    if (!owned.length) return null;
    await pool.execute<any>(`UPDATE company_automation_rules SET name=?,trigger_type=?,conditions_json=?,actions_json=?,updated_at=UTC_TIMESTAMP() WHERE id=? AND company_id=?`, [input.name, input.triggerType, JSON.stringify(input.conditions), JSON.stringify(input.actions), input.id, companyId]);
    return input.id;
  }
  const [result] = await pool.execute<any>(`INSERT INTO company_automation_rules(company_id,created_by_user_id,name,trigger_type,conditions_json,actions_json,enabled) VALUES(?,?,?,?,?,?,0)`, [companyId, userId, input.name, input.triggerType, JSON.stringify(input.conditions), JSON.stringify(input.actions)]);
  return Number(result.insertId);
}

export async function toggleAutomationRule(id: number, enabled: boolean) {
  const { companyId } = currentScope();
  const [owned] = await pool.query<any[]>('SELECT id FROM company_automation_rules WHERE id=? AND company_id=? LIMIT 1', [id, companyId]);
  if (!owned.length) return false;
  await pool.execute<any>('UPDATE company_automation_rules SET enabled=?,last_error=NULL,updated_at=UTC_TIMESTAMP() WHERE id=? AND company_id=?', [enabled ? 1 : 0, id, companyId]);
  return true;
}

export async function markAutomationNotificationRead(id: number) {
  const { companyId } = currentScope();
  const [result] = await pool.execute<any>('UPDATE company_automation_notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=? AND company_id=? AND dismissed_at IS NULL', [id, companyId]);
  return Number(result.affectedRows) > 0;
}

export async function dismissAutomationNotification(id: number) {
  const { companyId } = currentScope();
  const [result] = await pool.execute<any>('UPDATE company_automation_notifications SET dismissed_at=UTC_TIMESTAMP() WHERE id=? AND company_id=? AND dismissed_at IS NULL', [id, companyId]);
  return Number(result.affectedRows) > 0;
}

function listingFacts(row: any): { region: string; category: string; text: string } {
  const payload = parseJson<any>(row.payload_json, {});
  const region = String(payload.Region?.NombreRegion ?? payload.Region ?? payload.region ?? payload.NombreRegion ?? '');
  const items = payload.Items?.Listado;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const category = list.map((item: any) => String(item.Categoria ?? item.category ?? '')).filter(Boolean).join(' ');
  const text = [row.nombre, row.organismo, payload.Descripcion, payload.Nombre, ...list.flatMap((item: any) => [item.NombreProducto, item.Nombre, item.Descripcion, item.Categoria])].filter(Boolean).join(' ');
  return { region, category, text };
}

async function candidatesFor(rule: any): Promise<AutomationCandidate[]> {
  const conditions = parseJson<AutomationConditions>(rule.conditions_json, {});
  let rows: any[] = [];
  if (rule.trigger_type === 'new_match') {
    [rows] = await pool.query<any[]>(`SELECT m.listing_code code,m.listing_name title,m.match_score score,m.created_at eventAt,l.payload_json,l.nombre,l.organismo,l.fecha_cierre
      FROM company_proactive_matches m JOIN licitaciones l ON l.codigo_externo=m.listing_code
      WHERE m.company_id=? AND m.dismissed_at IS NULL AND m.created_at>=?
        AND NOT EXISTS (SELECT 1 FROM company_automation_runs r WHERE r.company_id=m.company_id AND r.rule_id=? AND r.event_key=CONCAT('match:',m.listing_code))
      ORDER BY m.created_at,m.id LIMIT 250`, [rule.company_id, rule.created_at, rule.id]);
  } else {
    const days = Math.max(1, Math.min(60, Number(conditions.daysBeforeClose ?? 3)));
    [rows] = await pool.query<any[]>(`SELECT l.codigo_externo code,l.nombre title,l.fecha_cierre closeAt,l.payload_json,l.organismo
      FROM company_opportunity_tracking t JOIN licitaciones l ON l.codigo_externo=t.codigo_externo
      WHERE t.company_id=? AND t.estado NOT IN ('discarded','submitted') AND l.fecha_cierre>=UTC_TIMESTAMP() AND l.fecha_cierre<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? DAY)
        AND NOT EXISTS (SELECT 1 FROM company_automation_runs r WHERE r.company_id=t.company_id AND r.rule_id=? AND r.event_key=CONCAT('closing:',t.codigo_externo))
      ORDER BY l.fecha_cierre,t.id LIMIT 250`, [rule.company_id, days, rule.id]);
  }
  return rows.map(row => {
    const facts = listingFacts(row); const close = row.closeAt ?? row.fecha_cierre;
    const dueAt = close ? new Date(close) : null; const code = String(row.code);
    const key = rule.trigger_type === 'new_match' ? `match:${code}` : `closing:${code}`;
    return { code, title: String(row.title ?? row.nombre ?? code), region: facts.region, category: facts.category, text: facts.text, score: row.score == null ? null : Number(row.score), eventKey: key, dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null };
  }).filter(candidate => automationCandidateMatches(candidate, conditions, rule.trigger_type));
}

async function executeCandidate(rule: any, candidate: AutomationCandidate) {
  const connection = await pool.getConnection();
  let started = false;
  try {
    const [inserted] = await connection.execute<any>(`INSERT IGNORE INTO company_automation_runs(company_id,rule_id,event_key,event_code,status) VALUES(?,?,?,?,'running')`, [rule.company_id, rule.id, candidate.eventKey, candidate.code]);
    if (!Number(inserted.affectedRows)) return false;
    started = true;
    const actions = parseJson<AutomationActions>(rule.actions_json, { createTask: false, taskLabel: '', taskDueDays: 1, assignUserId: null, notify: false });
    await runWithCompanyContext({ userId: Number(rule.created_by_user_id), companyId: Number(rule.company_id), role: 'admin', platformRole: 'user', systemAction: true }, async () => {
      if (actions.createTask || actions.assignUserId != null) {
        const tracked = await saveTrackedOpportunity(candidate.code);
        if (!tracked) throw new Error('La licitación ya no está disponible en el índice local.');
        if (actions.assignUserId != null) {
          const team = await getOpportunityTeam(candidate.code);
          await saveOpportunityTeam(candidate.code, { assignedUserId: actions.assignUserId, participantIds: team.participants.map(person => person.id) });
        }
        if (actions.createTask) {
          const dueAt = candidate.dueAt ?? new Date(Date.now() + Math.max(1, Math.min(60, actions.taskDueDays || 1)) * 86_400_000);
          const id = await addTrackedDate(tracked.id, { label: actions.taskLabel || 'Revisar oportunidad', dueAt: dueAt.toISOString().slice(0, 19).replace('T', ' '), notes: 'Tarea creada por una regla automatizada; revisa su fecha y contenido.' });
          if (!id) throw new Error('No se pudo crear la tarea de seguimiento.');
        }
      }
      if (actions.notify) {
        const eventLabel = rule.trigger_type === 'new_match' ? 'Se detectó una nueva coincidencia del perfil.' : 'Se acerca el cierre de una oportunidad guardada.';
        await pool.execute(`INSERT IGNORE INTO company_automation_notifications(company_id,rule_id,listing_code,event_key,title,message) VALUES(?,?,?,?,?,?)`, [rule.company_id, rule.id, candidate.code, candidate.eventKey, `Regla: ${rule.name}`, eventLabel]);
      }
    });
    await connection.execute("UPDATE company_automation_runs SET status='completed',finished_at=UTC_TIMESTAMP() WHERE company_id=? AND rule_id=? AND event_key=?", [rule.company_id, rule.id, candidate.eventKey]);
    await connection.execute('UPDATE company_automation_rules SET last_run_at=UTC_TIMESTAMP(),last_error=NULL WHERE id=? AND company_id=?', [rule.id, rule.company_id]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Falló la ejecución de la regla.';
    if (started) await connection.execute("UPDATE company_automation_runs SET status='failed',error_summary=?,finished_at=UTC_TIMESTAMP() WHERE company_id=? AND rule_id=? AND event_key=?", [message, rule.company_id, rule.id, candidate.eventKey]);
    await connection.execute('UPDATE company_automation_rules SET last_run_at=UTC_TIMESTAMP(),last_error=? WHERE id=? AND company_id=?', [message, rule.id, rule.company_id]);
    return false;
  } finally { connection.release(); }
}

export async function runAutomationPass() {
  const [rules] = await pool.query<any[]>("SELECT * FROM company_automation_rules WHERE enabled=1 ORDER BY company_id,id LIMIT 500");
  const summary = { rules: rules.length, checked: 0, executed: 0, failed: 0 };
  for (const rule of rules) {
    try {
      const candidates = await candidatesFor(rule);
      for (const candidate of candidates) { summary.checked++; const result = await executeCandidate(rule, candidate); if (result) summary.executed++; }
    } catch (error) {
      summary.failed++;
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Falló la evaluación.';
      await pool.execute('UPDATE company_automation_rules SET last_run_at=UTC_TIMESTAMP(),last_error=? WHERE id=? AND company_id=?', [message, rule.id, rule.company_id]);
    }
  }
  return summary;
}
