import pool from './db.js';
import { currentCompanyContext } from './companyRequestContext.js';

function companyId() {
  const id = currentCompanyContext()?.companyId;
  if (!id) throw new Error('La sesión requiere una empresa activa.');
  return id;
}

function decode(row: any) {
  let surcharges = row.recargos_json;
  if (typeof surcharges === 'string') {
    try { surcharges = JSON.parse(surcharges); } catch { surcharges = []; }
  }
  return {
    id: Number(row.id), name: row.nombre, category: row.categoria, unit: row.unidad,
    basePrice: Number(row.precio_base), baseCost: Number(row.costo_base), chargeUnit: row.unidad_cobro,
    widthM: row.ancho_m == null ? '' : Number(row.ancho_m), heightM: row.alto_m == null ? '' : Number(row.alto_m),
    specifications: row.especificaciones, surcharges: Array.isArray(surcharges) ? surcharges : [],
    active: Boolean(row.activo), updatedAt: row.updated_at,
  };
}

const selectColumns = 'id,nombre,categoria,unidad,precio_base,costo_base,unidad_cobro,ancho_m,alto_m,especificaciones,recargos_json,activo,updated_at';

export async function listPriceBookItems() {
  const [rows] = await pool.query<any[]>(`SELECT ${selectColumns} FROM company_price_book_items WHERE company_id=? ORDER BY activo DESC,categoria,nombre`, [companyId()]);
  return rows.map(decode);
}

export async function savePriceBookItems(items: any[]) {
  const id = companyId();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const item of items) {
      await conn.execute(
        `INSERT INTO company_price_book_items (company_id,nombre,categoria,unidad,precio_base,costo_base,unidad_cobro,ancho_m,alto_m,especificaciones,recargos_json,activo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE categoria=VALUES(categoria),unidad=VALUES(unidad),precio_base=VALUES(precio_base),costo_base=VALUES(costo_base),unidad_cobro=VALUES(unidad_cobro),ancho_m=VALUES(ancho_m),alto_m=VALUES(alto_m),especificaciones=VALUES(especificaciones),recargos_json=VALUES(recargos_json),activo=VALUES(activo),updated_at=CURRENT_TIMESTAMP`,
        [id,item.name,item.category,item.unit,item.basePrice,item.baseCost,item.chargeUnit,item.widthM || null,item.heightM || null,item.specifications,JSON.stringify(item.surcharges),item.active],
      );
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  return listPriceBookItems();
}

export async function deletePriceBookItem(itemId: number) {
  const [result] = await pool.execute<any>('DELETE FROM company_price_book_items WHERE company_id=? AND id=?', [companyId(), itemId]);
  return Number(result.affectedRows) > 0;
}
