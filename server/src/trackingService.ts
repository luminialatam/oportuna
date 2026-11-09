import pool from './db.js';
import { resolveCurrentCompanyId } from './companyService.js';
import { evaluateAlerts } from './alertService.js';

export const trackingStates = ['saved', 'evaluating', 'preparing_offer', 'submitted', 'discarded'] as const;

export async function listTrackedOpportunities(filters: { estado?: string; q?: string }) {
  const companyId = await resolveCurrentCompanyId();
  const where = ['t.company_id=?']; const values: unknown[] = [companyId];
  if (filters.estado && trackingStates.includes(filters.estado as any)) { where.push('t.estado=?'); values.push(filters.estado); }
  const q = filters.q?.trim().slice(0, 120);
  if (q) { where.push('(l.nombre LIKE ? OR l.codigo_externo LIKE ? OR l.organismo LIKE ?)'); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const [rows] = await pool.query<any[]>(`SELECT t.id,t.codigo_externo,t.estado,t.notes,t.created_at,t.updated_at,l.nombre,l.codigo_estado,l.fecha_cierre,l.organismo,l.monto_estimado,l.moneda
    FROM company_opportunity_tracking t JOIN licitaciones l ON l.codigo_externo=t.codigo_externo
    WHERE ${where.join(' AND ')} ORDER BY FIELD(t.estado,'evaluating','preparing_offer','submitted','saved','discarded'),t.updated_at DESC LIMIT 500`, values);
  if (!rows.length) return [];
  const ids = rows.map(row => Number(row.id));
  const [dates] = await pool.query<any[]>(`SELECT id,tracking_id,label,due_at,notes,completed FROM company_opportunity_dates WHERE company_id=? AND tracking_id IN (${ids.map(() => '?').join(',')}) ORDER BY due_at,id`, [companyId, ...ids]);
  const byTracking = new Map<number, any[]>();
  for (const date of dates) { const key = Number(date.tracking_id); const list = byTracking.get(key) ?? []; list.push({ id: Number(date.id), label: date.label, dueAt: date.due_at, notes: date.notes ?? '', completed: Boolean(date.completed) }); byTracking.set(key, list); }
  return rows.map(row => ({ id: Number(row.id), codigo: row.codigo_externo, estado: row.estado, notes: row.notes ?? '', createdAt: row.created_at, updatedAt: row.updated_at, listing: { nombre: row.nombre, codigoEstado: row.codigo_estado, fechaCierre: row.fecha_cierre, organismo: row.organismo, montoEstimado: row.monto_estimado, moneda: row.moneda }, dates: byTracking.get(Number(row.id)) ?? [] }));
}

export async function getTrackedCounts() {
  const companyId = await resolveCurrentCompanyId();
  const [rows] = await pool.query<any[]>('SELECT estado,COUNT(*) total FROM company_opportunity_tracking WHERE company_id=? GROUP BY estado', [companyId]);
  return Object.fromEntries(trackingStates.map(state => [state, Number(rows.find(row => row.estado === state)?.total ?? 0)]));
}

export async function getTrackedStatus(codigo: string) {
  const companyId=await resolveCurrentCompanyId();
  const [rows]=await pool.query<any[]>('SELECT estado FROM company_opportunity_tracking WHERE company_id=? AND codigo_externo=? LIMIT 1',[companyId,codigo]);
  return { saved: rows.length>0, estado: rows[0]?.estado??null };
}

export async function saveTrackedOpportunity(codigo: string) {
  const companyId = await resolveCurrentCompanyId();
  const [listings] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1', [codigo]);
  if (!listings.length) return null;
  const [insert] = await pool.execute<any>('INSERT IGNORE INTO company_opportunity_tracking (company_id,codigo_externo) VALUES (?,?)', [companyId, codigo]);
  const [rows] = await pool.query<any[]>('SELECT id,estado FROM company_opportunity_tracking WHERE company_id=? AND codigo_externo=?', [companyId, codigo]);
  if (insert.affectedRows) await evaluateAlerts();
  return { id: Number(rows[0].id), estado: rows[0].estado, created: insert.affectedRows > 0 };
}

export async function updateTrackedOpportunity(id: number, input: { estado?: string; notes?: string | null }) {
  const companyId = await resolveCurrentCompanyId();
  const fields: string[] = []; const values: any[] = [];
  if (input.estado) { fields.push('estado=?'); values.push(input.estado); }
  if (input.notes !== undefined) { fields.push('notes=?'); values.push(input.notes); }
  if (!fields.length) return false;
  const [result] = await pool.execute<any>(`UPDATE company_opportunity_tracking SET ${fields.join(',')} WHERE id=? AND company_id=?`, [...values, id, companyId]);
  if (result.affectedRows) await evaluateAlerts();
  return result.affectedRows > 0;
}

export async function deleteTrackedOpportunity(id: number) {
  const companyId = await resolveCurrentCompanyId();
  const [result] = await pool.execute<any>('DELETE FROM company_opportunity_tracking WHERE id=? AND company_id=?', [id, companyId]);
  if (result.affectedRows) await evaluateAlerts();
  return result.affectedRows > 0;
}

export async function addTrackedDate(trackingId: number, input: { label: string; dueAt: string; notes?: string | null }) {
  const companyId = await resolveCurrentCompanyId();
  const [result] = await pool.execute<any>('INSERT INTO company_opportunity_dates (tracking_id,company_id,label,due_at,notes) SELECT id,company_id,?,?,? FROM company_opportunity_tracking WHERE id=? AND company_id=?', [input.label, input.dueAt, input.notes ?? null, trackingId, companyId]);
  if (result.affectedRows) await evaluateAlerts();
  return result.affectedRows ? Number(result.insertId) : null;
}

export async function updateTrackedDate(trackingId: number, dateId: number, input: { label?: string; dueAt?: string; notes?: string | null; completed?: boolean }) {
  const companyId = await resolveCurrentCompanyId(); const fields: string[] = []; const values: any[] = [];
  if (input.label !== undefined) { fields.push('label=?'); values.push(input.label); }
  if (input.dueAt !== undefined) { fields.push('due_at=?'); values.push(input.dueAt); }
  if (input.notes !== undefined) { fields.push('notes=?'); values.push(input.notes); }
  if (input.completed !== undefined) { fields.push('completed=?'); values.push(input.completed ? 1 : 0); }
  if (!fields.length) return false;
  const [result] = await pool.execute<any>(`UPDATE company_opportunity_dates SET ${fields.join(',')} WHERE id=? AND tracking_id=? AND company_id=?`, [...values, dateId, trackingId, companyId]);
  if (result.affectedRows) await evaluateAlerts();
  return result.affectedRows > 0;
}

export async function deleteTrackedDate(trackingId: number, dateId: number) {
  const companyId = await resolveCurrentCompanyId();
  const [result] = await pool.execute<any>('DELETE FROM company_opportunity_dates WHERE id=? AND tracking_id=? AND company_id=?', [dateId, trackingId, companyId]);
  if (result.affectedRows) await evaluateAlerts();
  return result.affectedRows > 0;
}
