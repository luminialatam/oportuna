import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { getByCode } from '../src/mercadoPublico.js';
import { clearCompanyMatchCache } from '../src/companyService.js';
import { indexOfficialDetail } from '../src/listingEnrichment.js';
import { scoreCatalogMatch } from '../src/commercialMatching.js';

const targets = [
  { code: '5741-1-LE26', product: { nombre: 'Equipamiento gastronómico', categoria: 'Equipamiento para cocinas y comedores', palabrasClave: ['horno combinado', 'lavavajillas industrial', 'horno convector industrial'] } },
  { code: '2111-335-LE26', product: { nombre: 'Equipamiento gastronómico', categoria: 'Equipamiento para cocinas y comedores', palabrasClave: ['horno combinado', 'lavavajillas industrial', 'horno convector industrial'] } },
];

function objectValue(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
  return {};
}
function listingText(row: any) {
  const payload = objectValue(row.payload_json);
  const detail = typeof payload.Descripcion === 'string' ? payload.Descripcion : '';
  const items = Array.isArray(row.items) ? row.items : [];
  const itemText = items.map((item: any) => [item.nombre, item.descripcion, item.categoria].filter(Boolean).join(' ')).join(' ');
  return { payload, detail, items, itemText };
}
function hasOfficialDetail(row: any) {
  const { payload, detail, items } = listingText(row);
  return ['completed', 'empty'].includes(String(row.enrichment_state)) || Boolean(
    detail.trim() || items.length || payload.Comprador?.NombreOrganismo || payload.MontoEstimado != null ||
    ['Documentos', 'Archivos', 'Anexos', 'Adjuntos'].some(key => Array.isArray(payload[key]) && payload[key].length),
  );
}
async function readTarget(code: string) {
  const [rows] = await pool.query<any[]>(
    `SELECT l.codigo_externo,l.nombre,l.codigo_estado,l.fecha_publicacion,l.fecha_cierre,l.organismo,l.monto_estimado,l.moneda,l.payload_json,
       e.estado enrichment_state,e.total_partidas,
       (SELECT COUNT(*) FROM licitacion_items i WHERE i.codigo_externo=l.codigo_externo) item_count
     FROM licitaciones l LEFT JOIN licitacion_enrichment e USING(codigo_externo) WHERE l.codigo_externo=?`, [code],
  );
  if (!rows[0]) throw new Error(`La ficha ${code} no existe en el inventario local.`);
  const [items] = await pool.query<any[]>(
    'SELECT item_index,nombre,descripcion,categoria,cantidad,unidad_medida FROM licitacion_items WHERE codigo_externo=? ORDER BY item_index', [code],
  );
  return { ...rows[0], items };
}
async function inventory() {
  const [rows] = await pool.query<any[]>(`SELECT COUNT(*) listings,COUNT(DISTINCT codigo_externo) unique_codes,
    (SELECT COUNT(*) FROM licitacion_items) item_rows,
    (SELECT COUNT(DISTINCT codigo_externo) FROM licitacion_items) listings_with_items FROM licitaciones`);
  return { listings: Number(rows[0].listings), uniqueCodes: Number(rows[0].unique_codes), itemRows: Number(rows[0].item_rows), listingsWithItems: Number(rows[0].listings_with_items) };
}
function match(row: any, product: any) {
  const { detail, itemText } = listingText(row);
  return scoreCatalogMatch(product, String(row.nombre ?? ''), detail, itemText);
}
function officialSummary(detail: Record<string, any>) {
  const buyer = detail.Comprador && typeof detail.Comprador === 'object' ? detail.Comprador : {};
  const dates = detail.Fechas && typeof detail.Fechas === 'object' ? detail.Fechas : {};
  const rawItems = detail.Items?.Listado;
  const items = Array.isArray(rawItems) ? rawItems : rawItems && typeof rawItems === 'object' ? [rawItems] : [];
  const attachmentKeys = Object.keys(detail).filter(key => /document|archivo|anexo|adjunto/i.test(key) && detail[key] != null && detail[key] !== '');
  return {
    code: detail.CodigoExterno ?? null,
    title: detail.Nombre ?? null,
    description: detail.Descripcion ?? null,
    buyer: { organization: buyer.NombreOrganismo ?? null, unit: buyer.NombreUnidad ?? null, code: buyer.CodigoUnidad ?? null, region: buyer.RegionUnidad ?? buyer.Region ?? null },
    dates: { published: dates.FechaPublicacion ?? dates.FechaCreacion ?? null, close: detail.FechaCierre ?? dates.FechaCierre ?? null },
    amount: detail.MontoEstimado ?? null,
    amountVisibility: detail.MontoEstimado != null ? 'informado' : detail.VisibilidadMonto === 0 ? 'no visible en la ficha API' : 'no informado por la API',
    estimated: detail.Estimacion ?? null,
    currency: detail.Moneda ?? null,
    state: detail.CodigoEstado ?? null,
    items: items.map((item: any, index: number) => ({ index, name: item.NombreProducto ?? item.Nombre ?? null, description: item.Descripcion ?? null, category: item.Categoria ?? item.CodigoCategoria ?? null, quantity: item.Cantidad ?? null, unit: item.UnidadMedida ?? null })),
    attachmentFields: attachmentKeys.map(key => ({ field: key, count: Array.isArray(detail[key]) ? detail[key].length : 1 })),
    attachmentStatus: attachmentKeys.length ? 'La respuesta API contiene campos relacionados con documentos; no se descargaron ni revisaron.' : 'La respuesta API no contiene campos de documentos o adjuntos; revisar las bases oficiales por separado.',
  };
}

let workerConnection: any;
let workerLocked = false;
try {
  const ticketConfigured = Boolean(process.env.MERCADOPUBLICO_TICKET?.trim());
  assert.ok(ticketConfigured, 'Falta configurar el ticket local de Mercado Público.');
  const beforeInventory = await inventory();
  assert.equal(beforeInventory.listings, 19608, 'El inventario local debe comenzar con 19.608 licitaciones.');
  assert.equal(beforeInventory.uniqueCodes, beforeInventory.listings, 'El inventario local ya contiene códigos duplicados.');
  const beforeRows = await Promise.all(targets.map(target => readTarget(target.code)));
  const before = beforeRows.map((row, index) => ({
    code: targets[index].code, title: row.nombre, description: listingText(row).detail || null,
    itemCount: row.items.length, enrichmentState: row.enrichment_state ?? null,
    match: match(row, targets[index].product), alreadyEnriched: hasOfficialDetail(row),
  }));

  // Exclude the background enrichment worker while these two allow-listed details are processed.
  workerConnection = await pool.getConnection();
  const [lockRows] = await workerConnection.query<any[]>("SELECT GET_LOCK('oportuna_enrichment_worker',0) acquired");
  workerLocked = Number(lockRows[0]?.acquired) === 1;
  assert.ok(workerLocked, 'El worker de enriquecimiento está ocupado; no se inició ninguna consulta API.');

  const official: Array<{ code: string; summary: any; apiError: string | null; skipped: boolean }> = [];
  for (const target of targets) {
    const current = await readTarget(target.code);
    if (hasOfficialDetail(current)) {
      official.push({ code: target.code, summary: null, apiError: null, skipped: true });
      continue;
    }
    try {
      const detail = await getByCode(target.code) as unknown as Record<string, any>;
      assert.equal(detail.CodigoExterno, target.code, `La API devolvió un código distinto para ${target.code}.`);
      const summary = officialSummary(detail);
      await indexOfficialDetail(target.code, detail);
      // Re-index the same response in-process to validate idempotency; this does not make another API request.
      await indexOfficialDetail(target.code, detail);
      official.push({ code: target.code, summary, apiError: null, skipped: false });
    } catch (error) {
      official.push({ code: target.code, summary: null, apiError: error instanceof Error ? error.message : 'Error API no identificado.', skipped: false });
    }
  }

  clearCompanyMatchCache();
  const afterRows = await Promise.all(targets.map(target => readTarget(target.code)));
  const after = afterRows.map((row, index) => {
    const payload = listingText(row).payload;
    const duplicateIndexes = new Set<number>();
    for (const item of row.items) {
      const itemIndex = Number(item.item_index);
      if (duplicateIndexes.has(itemIndex)) throw new Error(`Partida duplicada ${targets[index].code}#${itemIndex}.`);
      duplicateIndexes.add(itemIndex);
    }
    const scored = match(row, targets[index].product);
    assert.ok(!scored || scored.level !== 'high' || Boolean(scored.exactPhrase), `La ficha ${targets[index].code} subió a alta sin frase exacta.`);
    return {
      code: targets[index].code, title: row.nombre, description: payload.Descripcion ?? null,
      buyer: row.organismo ?? payload.Comprador?.NombreOrganismo ?? null,
      publishedAt: row.fecha_publicacion, closesAt: row.fecha_cierre,
      amount: row.monto_estimado, currency: row.moneda,
      items: row.items, itemCount: row.items.length, enrichmentState: row.enrichment_state ?? null,
      match: scored, coverage: { description: Boolean(payload.Descripcion), buyer: Boolean(row.organismo ?? payload.Comprador?.NombreOrganismo), items: row.items.length > 0 },
    };
  });
  const afterInventory = await inventory();
  assert.equal(afterInventory.listings, beforeInventory.listings);
  assert.equal(afterInventory.uniqueCodes, beforeInventory.uniqueCodes);
  assert.equal(afterInventory.listings, afterInventory.uniqueCodes);
  process.stdout.write(JSON.stringify({
    mode: 'solo dos códigos allow-list; API oficial Mercado Público; sin sincronización ni Groq',
    api: { requestsForThisRun: official.filter(row => !row.skipped && !row.apiError).length, minIntervalMs: Math.max(2000, Number(process.env.MERCADOPUBLICO_MIN_INTERVAL_MS) || 2000), results: official },
    inventory: { before: beforeInventory, after: afterInventory },
    before, after,
  }, null, 2) + '\n');
} finally {
  if (workerLocked && workerConnection) await workerConnection.query("SELECT RELEASE_LOCK('oportuna_enrichment_worker')").catch(() => undefined);
  workerConnection?.release();
  await pool.end();
}
