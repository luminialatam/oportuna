import pool from './db.js';
import { analyticsModalitySql, analyticsRegionSql, buildAnalyticsWhere, type AnalyticsFilters } from './analyticsFilters.js';

const supplierSql = `COALESCE(
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Adjudicacion.Proveedor.Nombre')),''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Adjudicacion.NombreProveedor')),''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Adjudicacion.Listado[0].Proveedor.Nombre')),''),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Adjudicacion.Listado[0].NombreProveedor')),'')
)`;

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

export async function getAnalytics(filters: AnalyticsFilters, companyId: number) {
  const { sql, values } = buildAnalyticsWhere(filters);
  const [summaryRows, stateRows, modalityRows, buyerRows, regionRows, categoryRows, monthRows, supplierRows, pipelineRows] = await Promise.all([
    pool.query<any[]>(`SELECT COUNT(*) total,COUNT(DISTINCT NULLIF(l.organismo,'')) buyers,
      SUM(CASE WHEN UPPER(COALESCE(l.moneda,''))='CLP' AND l.monto_estimado IS NOT NULL THEN l.monto_estimado ELSE 0 END) amountClp,
      SUM(UPPER(COALESCE(l.moneda,''))='CLP' AND l.monto_estimado IS NOT NULL) amountClpRecords,
      SUM(l.monto_estimado IS NULL OR l.moneda IS NULL OR UPPER(l.moneda)<>'CLP') amountNotComparable,
      SUM(l.codigo_estado=5 AND (l.fecha_cierre IS NULL OR l.fecha_cierre>=UTC_TIMESTAMP())) openListings,
      SUM(l.organismo IS NOT NULL AND TRIM(l.organismo)<>'') withBuyer,
      SUM(${analyticsRegionSql} IS NOT NULL AND ${analyticsRegionSql}<>'null') withRegion,
      SUM(l.monto_estimado IS NOT NULL AND l.moneda IS NOT NULL) withDeclaredAmount,
      COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo) THEN l.codigo_externo END) listingsWithItems
      FROM licitaciones l WHERE ${sql}`,
    [...values]),
    pool.query<any[]>(`SELECT l.codigo_estado state,COUNT(*) total FROM licitaciones l WHERE ${sql} GROUP BY l.codigo_estado ORDER BY total DESC`, [...values]),
    pool.query<any[]>(`SELECT COALESCE(${analyticsModalitySql},'Sin modalidad informada') label,COUNT(*) total FROM licitaciones l WHERE ${sql} GROUP BY label ORDER BY total DESC LIMIT 12`, [...values]),
    pool.query<any[]>(`SELECT l.organismo label,COUNT(*) total,COUNT(DISTINCT l.codigo_externo) listings FROM licitaciones l WHERE ${sql} AND l.organismo IS NOT NULL AND TRIM(l.organismo)<>'' GROUP BY l.organismo ORDER BY total DESC LIMIT 12`, [...values]),
    pool.query<any[]>(`SELECT ${analyticsRegionSql} label,COUNT(*) total FROM licitaciones l WHERE ${sql} AND ${analyticsRegionSql} IS NOT NULL AND ${analyticsRegionSql}<>'null' GROUP BY label ORDER BY total DESC LIMIT 12`, [...values]),
    pool.query<any[]>(`SELECT COALESCE(NULLIF(TRIM(i.categoria),''),NULLIF(TRIM(i.nombre),''),'Sin categoría informada') label,
      COUNT(DISTINCT l.codigo_externo) listings,COUNT(*) items FROM licitaciones l JOIN licitacion_items i ON i.codigo_externo=l.codigo_externo WHERE ${sql}
      GROUP BY label ORDER BY listings DESC,items DESC LIMIT 15`, [...values]),
    pool.query<any[]>(`SELECT DATE_FORMAT(COALESCE(l.fecha_publicacion,l.last_synced_at),'%Y-%m') month,
      COUNT(*) listings,SUM(CASE WHEN UPPER(COALESCE(l.moneda,''))='CLP' AND l.monto_estimado IS NOT NULL THEN l.monto_estimado ELSE 0 END) amountClp,
      SUM(UPPER(COALESCE(l.moneda,''))='CLP' AND l.monto_estimado IS NOT NULL) amountClpRecords
      FROM licitaciones l WHERE ${sql} GROUP BY month ORDER BY month`, [...values]),
    pool.query<any[]>(`SELECT ${supplierSql} label,COUNT(DISTINCT l.codigo_externo) awards FROM licitaciones l WHERE ${sql}
      AND l.codigo_estado=8 AND ${supplierSql} IS NOT NULL AND ${supplierSql}<>'null' GROUP BY label ORDER BY awards DESC LIMIT 12`, [...values]),
    pool.query<any[]>(`SELECT t.estado,COUNT(*) total,
      SUM(CASE WHEN UPPER(COALESCE(l.moneda,''))='CLP' AND l.monto_estimado IS NOT NULL THEN l.monto_estimado ELSE 0 END) amountClp,
      SUM(UPPER(COALESCE(l.moneda,''))='CLP' AND l.monto_estimado IS NOT NULL) amountClpRecords
      FROM company_opportunity_tracking t JOIN licitaciones l ON l.codigo_externo=t.codigo_externo WHERE t.company_id=? AND ${sql} GROUP BY t.estado`, [companyId, ...values]),
  ]);
  const raw = summaryRows[0]?.[0] ?? {};
  const total = number(raw.total);
  const amountClp = number(raw.amountClp);
  const amountClpRecords = number(raw.amountClpRecords);
  const amountNotComparable = number(raw.amountNotComparable);
  const states = stateRows[0].map((row: any) => ({ state: row.state == null ? null : number(row.state), total: number(row.total) }));
  const pipeline = Object.fromEntries(['saved','evaluating','preparing_offer','submitted','discarded'].map((state) => {
    const row = pipelineRows[0].find((entry: any) => entry.estado === state);
    return [state, { total: number(row?.total), amountClp: number(row?.amountClp), amountClpRecords: number(row?.amountClpRecords) }];
  }));
  return {
    generatedAt: new Date().toISOString(),
    filters,
    coverage: {
      total,
      withBuyer: number(raw.withBuyer),
      withRegion: number(raw.withRegion),
      withDeclaredAmount: number(raw.withDeclaredAmount),
      listingsWithItems: number(raw.listingsWithItems),
      amountClpRecords,
      amountNotComparable,
    },
    summary: {
      total,
      buyers: number(raw.buyers),
      openListings: number(raw.openListings),
      amountClp,
      amountClpRecords,
      amountComparable: amountNotComparable === 0 && amountClpRecords === total && total > 0,
    },
    states,
    modalities: modalityRows[0].map((row: any) => ({ label: String(row.label), total: number(row.total) })),
    buyers: buyerRows[0].map((row: any) => ({ label: String(row.label), total: number(row.total), listings: number(row.listings) })),
    regions: regionRows[0].map((row: any) => ({ label: String(row.label), total: number(row.total) })),
    categories: categoryRows[0].map((row: any) => ({ label: String(row.label), listings: number(row.listings), items: number(row.items) })),
    trend: monthRows[0].map((row: any) => ({ month: String(row.month), listings: number(row.listings), amountClp: number(row.amountClp), amountClpRecords: number(row.amountClpRecords) })),
    competitors: supplierRows[0].map((row: any) => ({ label: String(row.label), awards: number(row.awards) })),
    pipeline,
    methodology: {
      source: 'Licitaciones y partidas indexadas localmente en Oportuna.',
      period: `${filters.dateFrom} a ${filters.dateTo}`,
      amount: 'Solo se agregan montos con moneda explícita CLP; el total no representa valores en otras monedas ni montos ausentes.',
      categories: 'Las categorías cuentan fichas y partidas indexadas; no representan ventas ni gasto por categoría.',
      competitors: 'Solo incluye adjudicatarios explícitos encontrados en el payload oficial detallado de procesos adjudicados.',
      performance: 'Mi desempeño cuenta las oportunidades guardadas por la empresa activa y su estado actual en Seguimiento.',
    },
  };
}

function csvCell(value: unknown) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportAnalyticsCsv(filters: AnalyticsFilters) {
  const { sql, values } = buildAnalyticsWhere(filters);
  const [rows] = await pool.query<any[]>(`SELECT l.codigo_externo,l.nombre,l.organismo,${analyticsRegionSql} region,
      ${analyticsModalitySql} modality,l.codigo_estado,l.fecha_publicacion,l.fecha_cierre,l.monto_estimado,l.moneda,
      (SELECT COUNT(*) FROM licitacion_items i WHERE i.codigo_externo=l.codigo_externo) items
    FROM licitaciones l WHERE ${sql} ORDER BY COALESCE(l.fecha_publicacion,l.last_synced_at) DESC,l.codigo_externo LIMIT 20000`, [...values]);
  const headers = ['Código','Oportunidad','Organismo comprador','Región','Modalidad (código o fuente)','Estado oficial','Publicación','Cierre','Monto estimado','Moneda','Partidas indexadas'];
  const lines = [headers, ...rows.map((row: any) => [row.codigo_externo,row.nombre,row.organismo,row.region,row.modality,row.codigo_estado,row.fecha_publicacion,row.fecha_cierre,row.monto_estimado,row.moneda,row.items])];
  return { csv: `\uFEFF${lines.map(line => line.map(csvCell).join(';')).join('\r\n')}`, exported: rows.length, limit: 20000 };
}

export async function listAnalyticsViews(companyId: number, userId: number) {
  const [rows] = await pool.query<any[]>(`SELECT id,name,filters_json filters,created_at createdAt,updated_at updatedAt
    FROM analytics_saved_views WHERE company_id=? AND user_id=? ORDER BY updated_at DESC,id DESC`, [companyId,userId]);
  return rows.map((row: any) => ({ id: Number(row.id), name: String(row.name), filters: typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters, createdAt: row.createdAt, updatedAt: row.updatedAt }));
}

export async function saveAnalyticsView(companyId: number, userId: number, name: string, filters: AnalyticsFilters) {
  const [result] = await pool.execute<any>(`INSERT INTO analytics_saved_views (company_id,user_id,name,filters_json)
    VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE filters_json=VALUES(filters_json),updated_at=UTC_TIMESTAMP()`,
  [companyId,userId,name,JSON.stringify(filters)]);
  const [rows] = await pool.query<any[]>('SELECT id,name FROM analytics_saved_views WHERE company_id=? AND user_id=? AND name=? LIMIT 1',[companyId,userId,name]);
  return { id: Number(rows[0]?.id ?? result.insertId), name, filters };
}

export async function deleteAnalyticsView(companyId: number, userId: number, id: number) {
  const [result] = await pool.execute<any>('DELETE FROM analytics_saved_views WHERE id=? AND company_id=? AND user_id=?',[id,companyId,userId]);
  return Number(result.affectedRows) > 0;
}
