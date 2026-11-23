export type AnalyticsFilters = {
  dateFrom: string;
  dateTo: string;
  modality: string;
  product: string;
  organism: string;
  region: string;
  state: string;
};

export const defaultAnalyticsFilters = (now = new Date()): AnalyticsFilters => ({
  dateFrom: `${now.getUTCFullYear()}-01-01`,
  dateTo: now.toISOString().slice(0, 10),
  modality: '',
  product: '',
  organism: '',
  region: '',
  state: '',
});

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeAnalyticsFilters(input: Partial<AnalyticsFilters>, now = new Date()): AnalyticsFilters {
  const defaults = defaultAnalyticsFilters(now);
  const output: AnalyticsFilters = {
    dateFrom: input.dateFrom?.trim() || defaults.dateFrom,
    dateTo: input.dateTo?.trim() || defaults.dateTo,
    modality: input.modality?.trim().slice(0, 80) || '',
    product: input.product?.trim().slice(0, 120) || '',
    organism: input.organism?.trim().slice(0, 160) || '',
    region: input.region?.trim().slice(0, 120) || '',
    state: input.state?.trim() || '',
  };
  if (!validDate(output.dateFrom) || !validDate(output.dateTo) || output.dateFrom > output.dateTo) {
    throw new Error('El período de analítica no es válido.');
  }
  if (output.state && !/^\d{1,3}$/.test(output.state)) throw new Error('El estado seleccionado no es válido.');
  return output;
}

export const analyticsRegionSql = `COALESCE(
  NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Comprador.RegionUnidad')),''),'null'),
  NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Comprador.Region')),''),'null')
)`;

// Prefer an explicit modality supplied by the source; otherwise use only the
// modality code embedded in the public tender identifier, without guessing a label.
export const analyticsModalitySql = `COALESCE(
  NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Modalidad')),''),'null'),
  NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.TipoCompra')),''),'null'),
  NULLIF(REGEXP_REPLACE(SUBSTRING_INDEX(l.codigo_externo,'-',-1),'[0-9]{2}$',''),'')
)`;

export function buildAnalyticsWhere(filters: AnalyticsFilters) {
  const where = [
    `COALESCE(l.fecha_publicacion,l.last_synced_at)>=?`,
    `COALESCE(l.fecha_publicacion,l.last_synced_at)<DATE_ADD(?,INTERVAL 1 DAY)`,
  ];
  const values: unknown[] = [`${filters.dateFrom} 00:00:00`, `${filters.dateTo} 00:00:00`];
  if (filters.modality) { where.push(`${analyticsModalitySql}=?`); values.push(filters.modality); }
  if (filters.product) {
    where.push(`EXISTS (SELECT 1 FROM licitacion_items fi WHERE fi.codigo_externo=l.codigo_externo AND CONCAT_WS(' ',fi.nombre,fi.descripcion,fi.categoria,fi.search_text) LIKE ?)`);
    values.push(`%${filters.product}%`);
  }
  if (filters.organism) { where.push(`l.organismo LIKE ?`); values.push(`%${filters.organism}%`); }
  if (filters.region) { where.push(`${analyticsRegionSql}=?`); values.push(filters.region); }
  if (filters.state) { where.push(`l.codigo_estado=?`); values.push(Number(filters.state)); }
  return { sql: where.join(' AND '), values };
}
