import pool from './db.js';
import { currentCompanyContext } from './companyRequestContext.js';

function context() {
  const current = currentCompanyContext();
  if (!current?.companyId || !current.userId) throw new Error('La sesión requiere una empresa activa.');
  return { companyId: current.companyId, userId: current.userId };
}

export async function getOfferDraft(code: string) {
  const { companyId, userId } = context();
  const [rows] = await pool.query<any[]>(
    'SELECT draft_json,updated_at FROM company_offer_drafts WHERE company_id=? AND user_id=? AND codigo_externo=? LIMIT 1',
    [companyId, userId, code],
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
  await pool.execute(
    `INSERT INTO company_offer_drafts (company_id,user_id,codigo_externo,draft_json)
     VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE draft_json=VALUES(draft_json),updated_at=CURRENT_TIMESTAMP`,
    [companyId, userId, code, JSON.stringify(draft)],
  );
  return getOfferDraft(code);
}

export async function deleteOfferDraft(code: string) {
  const { companyId, userId } = context();
  const [result] = await pool.execute<any>(
    'DELETE FROM company_offer_drafts WHERE company_id=? AND user_id=? AND codigo_externo=?',
    [companyId, userId, code],
  );
  return Number(result.affectedRows) > 0;
}
