import pool from './db.js';
import { currentCompanyContext } from './companyRequestContext.js';
import { recordCompanyActivity } from './collaborationService.js';

function context() {
  const current = currentCompanyContext();
  if (!current?.companyId || !current.userId) throw new Error('La sesión requiere una empresa activa.');
  return { companyId: current.companyId, userId: current.userId };
}

export async function getOfferDraft(code: string) {
  const { companyId, userId } = context();
  let [rows] = await pool.query<any[]>('SELECT draft_json,updated_at,deleted_at FROM company_offer_workspaces WHERE company_id=? AND codigo_externo=? LIMIT 1', [companyId, code]);
  if (rows[0]?.deleted_at) return { draft: null, updatedAt: null };
  if (!rows.length) [rows] = await pool.query<any[]>(
    'SELECT draft_json,updated_at FROM company_offer_drafts WHERE company_id=? AND codigo_externo=? ORDER BY updated_at DESC,user_id LIMIT 1', [companyId, code],
  );
  if (!rows.length) return { draft: null, updatedAt: null };
  let draft: unknown = rows[0].draft_json;
  if (typeof draft === 'string') {
    try { draft = JSON.parse(draft); } catch { throw new Error('El borrador guardado no se pudo leer.'); }
  }
  return { draft, updatedAt: rows[0].updated_at };
}

export async function saveOfferDraft(code: string, draft: unknown) {
  const { companyId, userId } = context();
  const [listings] = await pool.query<any[]>(
    'SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1',
    [code],
  );
  if (!listings.length) return null;
  const previous = await getOfferDraft(code);
  await pool.execute(`INSERT INTO company_offer_workspaces(company_id,codigo_externo,draft_json,created_by_user_id,updated_by_user_id)
    VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE draft_json=VALUES(draft_json),updated_by_user_id=VALUES(updated_by_user_id),deleted_at=NULL,updated_at=UTC_TIMESTAMP()`,
  [companyId, code, JSON.stringify(draft), userId, userId]);
  await recordCompanyActivity(code, 'offer_updated', 'Se actualizó el borrador colaborativo de la oferta.');
  const oldDocs = Array.isArray((previous.draft as any)?.documents) ? (previous.draft as any).documents : [];
  const nextDocs = Array.isArray((draft as any)?.documents) ? (draft as any).documents : [];
  if (nextDocs.some((doc: any, index: number) => oldDocs[index]?.reviewStatus !== doc?.reviewStatus)) {
    await recordCompanyActivity(code, 'document_reviewed', 'Se actualizó el estado de revisión de documentos de la oferta.', { reviewedDocuments: nextDocs.filter((doc: any) => doc?.reviewStatus !== 'pending').length });
  }
  return getOfferDraft(code);
}

export async function deleteOfferDraft(code: string) {
  const { companyId, userId } = context();
  const [shared] = await pool.execute<any>(`INSERT INTO company_offer_workspaces(company_id,codigo_externo,draft_json,created_by_user_id,updated_by_user_id,deleted_at)
    VALUES(?,?,JSON_OBJECT(),?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE deleted_at=UTC_TIMESTAMP(),updated_by_user_id=VALUES(updated_by_user_id),updated_at=UTC_TIMESTAMP()`, [companyId, code, userId, userId]);
  const [legacy] = await pool.execute<any>('DELETE FROM company_offer_drafts WHERE company_id=? AND user_id=? AND codigo_externo=?', [companyId, userId, code]);
  const deleted = Number(legacy.affectedRows) > 0 || Number(shared.affectedRows) > 0;
  if (deleted) await recordCompanyActivity(code, 'offer_draft_deleted', 'Se eliminó el borrador de preparación.');
  return deleted;
}
