import pool from './db.js';
import { currentCompanyContext } from './companyRequestContext.js';

function scope() {
  const current = currentCompanyContext();
  if (!current?.companyId || !current.userId) throw new Error('Selecciona una empresa activa.');
  return { companyId: current.companyId, userId: current.userId };
}

export async function listActiveCompanyMembers() {
  const { companyId } = scope();
  const [rows] = await pool.query<any[]>(`SELECT u.id,TRIM(CONCAT(u.first_name,' ',u.last_name)) name,m.role
    FROM company_memberships m JOIN app_users u ON u.id=m.user_id
    WHERE m.company_id=? AND m.status='active' AND u.status='active' ORDER BY u.first_name,u.last_name,u.id`, [companyId]);
  return rows.map(row => ({ id: Number(row.id), name: String(row.name || 'Integrante'), role: String(row.role) }));
}

export async function recordCompanyActivity(code: string, type: string, summary: string, metadata?: Record<string, unknown>) {
  const current = currentCompanyContext();
  const { companyId, userId } = scope();
  const actorId = current?.systemAction ? null : userId;
  await pool.execute(`INSERT INTO company_activity_events(company_id,codigo_externo,actor_user_id,event_type,summary,metadata_json)
    SELECT ?,?,? ,?, ?,? FROM licitaciones WHERE codigo_externo=?`,
  [companyId, code, actorId, type.slice(0, 40), summary.slice(0, 500), metadata ? JSON.stringify(metadata) : null, code]);
}

export async function listOpportunityActivity(code: string) {
  const { companyId } = scope();
  const [rows] = await pool.query<any[]>(`SELECT e.id,e.event_type type,e.summary,e.created_at createdAt,
    CASE WHEN e.actor_user_id IS NULL THEN NULL ELSE TRIM(CONCAT(u.first_name,' ',u.last_name)) END actor
    FROM company_activity_events e LEFT JOIN app_users u ON u.id=e.actor_user_id
    WHERE e.company_id=? AND e.codigo_externo=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100`, [companyId, code]);
  return rows.map(row => ({ id: Number(row.id), type: row.type, summary: row.summary, createdAt: row.createdAt, actor: row.actor ?? null }));
}

export async function getOpportunityTeam(code: string) {
  const { companyId } = scope();
  const [rows] = await pool.query<any[]>(`SELECT t.assigned_user_id assignedUserId,
    TRIM(CONCAT(a.first_name,' ',a.last_name)) assignedName,t.updated_at updatedAt
    FROM company_opportunity_teams t LEFT JOIN app_users a ON a.id=t.assigned_user_id
    WHERE t.company_id=? AND t.codigo_externo=? LIMIT 1`, [companyId, code]);
  const [members] = await pool.query<any[]>(`SELECT tm.user_id id,TRIM(CONCAT(u.first_name,' ',u.last_name)) name,m.role
    FROM company_opportunity_team_members tm JOIN company_memberships m ON m.user_id=tm.user_id AND m.company_id=tm.company_id
    JOIN app_users u ON u.id=tm.user_id WHERE tm.company_id=? AND tm.codigo_externo=? AND m.status='active' AND u.status='active'
    ORDER BY u.first_name,u.last_name`, [companyId, code]);
  return { assignedUserId: rows[0]?.assignedUserId == null ? null : Number(rows[0].assignedUserId), assignedName: rows[0]?.assignedName ?? null,
    updatedAt: rows[0]?.updatedAt ?? null, participants: members.map(row => ({ id: Number(row.id), name: String(row.name || 'Integrante'), role: String(row.role) })) };
}

export async function saveOpportunityTeam(code: string, input: { assignedUserId: number | null; participantIds: number[] }) {
  const { companyId, userId } = scope();
  const actorId = currentCompanyContext()?.systemAction ? null : userId;
  const participants = [...new Set(input.participantIds)];
  const selected = [...participants, ...(input.assignedUserId == null ? [] : [input.assignedUserId])];
  const [listing] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1', [code]);
  if (!listing.length) return null;
  if (selected.length) {
    const [members] = await pool.query<any[]>(`SELECT m.user_id FROM company_memberships m JOIN app_users u ON u.id=m.user_id
      WHERE m.company_id=? AND m.status='active' AND u.status='active' AND m.user_id IN (${selected.map(() => '?').join(',')})`, [companyId, ...selected]);
    if (new Set(members.map(row => Number(row.user_id))).size !== new Set(selected).size) throw new Error('El responsable o participante no pertenece a la empresa activa.');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [previous] = await connection.query<any[]>('SELECT assigned_user_id FROM company_opportunity_teams WHERE company_id=? AND codigo_externo=? FOR UPDATE', [companyId, code]);
    let assignedName = '';
    if (input.assignedUserId != null) {
      const [person] = await connection.query<any[]>(`SELECT TRIM(CONCAT(u.first_name,' ',u.last_name)) name FROM company_memberships m JOIN app_users u ON u.id=m.user_id WHERE m.company_id=? AND m.user_id=? AND m.status='active'`, [companyId, input.assignedUserId]);
      assignedName = String(person[0]?.name ?? '');
    }
    await connection.execute(`INSERT INTO company_opportunity_teams(company_id,codigo_externo,assigned_user_id,updated_by_user_id)
      VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE assigned_user_id=VALUES(assigned_user_id),updated_by_user_id=VALUES(updated_by_user_id),updated_at=UTC_TIMESTAMP()`, [companyId, code, input.assignedUserId, actorId]);
    await connection.execute('DELETE FROM company_opportunity_team_members WHERE company_id=? AND codigo_externo=?', [companyId, code]);
    for (const id of participants) await connection.execute(`INSERT INTO company_opportunity_team_members(company_id,codigo_externo,user_id,added_by_user_id) VALUES(?,?,?,?)`, [companyId, code, id, userId]);
    if (Number(previous[0]?.assigned_user_id ?? 0) !== Number(input.assignedUserId ?? 0)) {
      await connection.execute(`INSERT INTO company_activity_events(company_id,codigo_externo,actor_user_id,event_type,summary,metadata_json)
        VALUES(?,?,?,'assignment_changed',?,?)`, [companyId, code, actorId, input.assignedUserId == null ? 'Se quitó el responsable de la oportunidad.' : `Se asignó como responsable a ${assignedName || 'un integrante activo'}.`, JSON.stringify({ assignedUserId: input.assignedUserId })]);
    } else {
      await connection.execute(`INSERT INTO company_activity_events(company_id,codigo_externo,actor_user_id,event_type,summary)
        VALUES(?,?,?,'participants_changed',?)`, [companyId, code, actorId, `Se actualizaron las personas participantes (${participants.length} seleccionadas).`]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  return getOpportunityTeam(code);
}
