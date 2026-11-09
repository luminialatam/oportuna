import pool from './db.js';
import { getByCode } from './mercadoPublico.js';
import { clearSearchCache } from './smartSearch.js';
import { rankEnrichmentCandidates, type EnrichmentCandidate, type PreviewProduct, type PreviewListingRow } from './enrichmentPreview.js';
import { loadRuntimeConfig } from './runtimeConfig.js';

type ApiItem = Record<string, unknown>;
let worker: Promise<void> | null = null;

function listItems(detail: Record<string, any>): ApiItem[] {
  const value = detail.Items?.Listado;
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  return rows.filter((row): row is ApiItem => Boolean(row && typeof row === 'object')).slice(0, 500);
}
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}
function decimal(value: unknown): number | null {
  if (value == null || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function preservedPayload(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) return value.map(preservedPayload).filter(item => item !== undefined);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, preservedPayload(item)] as const)
      .filter(([, item]) => item !== undefined);
    return Object.fromEntries(entries);
  }
  return value;
}
function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status: unknown }).status);
    if (Number.isFinite(status)) return `HTTP_${status}`;
  }
  return error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'API_ERROR';
}

async function storeDetail(code: string, detail: Record<string, any>) {
  const items = listItems(detail);
  const payload = JSON.stringify(preservedPayload(detail) ?? {});
  const state = detail.CodigoEstado == null || detail.CodigoEstado === '' ? null : Number(detail.CodigoEstado);
  const amount = decimal(detail.MontoEstimado);
  const date = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 19).replace('T', ' ');
  };
  const name = text(detail.Nombre, 500);
  const buyer = text(detail.Comprador?.NombreOrganismo, 500);
  const currency = text(detail.Moneda, 20);
  const closeAt = date(detail.FechaCierre ?? detail.Fechas?.FechaCierre);
  const publishAt = date(detail.Fechas?.FechaPublicacion ?? detail.Fechas?.FechaCreacion);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE licitaciones SET
        nombre=COALESCE(?,nombre),codigo_estado=COALESCE(?,codigo_estado),fecha_cierre=COALESCE(?,fecha_cierre),
        fecha_publicacion=COALESCE(?,fecha_publicacion),organismo=COALESCE(?,organismo),
        monto_estimado=COALESCE(?,monto_estimado),moneda=COALESCE(?,moneda),
        payload_json=JSON_MERGE_PATCH(COALESCE(payload_json,JSON_OBJECT()),CAST(? AS JSON))
       WHERE codigo_externo=?`,
      [name, Number.isFinite(state) ? state : null, closeAt, publishAt, buyer, amount, currency, payload, code],
    );
    for (const [index, item] of items.entries()) {
      const name = text(item.NombreProducto ?? item.Nombre, 1000);
      const description = text(item.Descripcion, 16000);
      const category = text(item.Categoria ?? item.CodigoCategoria, 255);
      const unit = text(item.UnidadMedida, 120);
      const searchable = [name, description, category].filter(Boolean).join(' ').slice(0, 17000);
      if (!searchable) continue;
      await connection.execute(
        `INSERT INTO licitacion_items
          (codigo_externo,item_index,nombre,descripcion,categoria,cantidad,unidad_medida,search_text)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           nombre=COALESCE(VALUES(nombre),nombre),descripcion=COALESCE(VALUES(descripcion),descripcion),
           categoria=COALESCE(VALUES(categoria),categoria),cantidad=COALESCE(VALUES(cantidad),cantidad),
           unidad_medida=COALESCE(VALUES(unidad_medida),unidad_medida),
           search_text=CASE
             WHEN INSTR(search_text,VALUES(search_text))>0 THEN search_text
             WHEN INSTR(VALUES(search_text),search_text)>0 THEN VALUES(search_text)
             ELSE CONCAT_WS(' ',NULLIF(search_text,''),NULLIF(VALUES(search_text),''))
           END`,
        [code, index, name, description, category, decimal(item.Cantidad), unit, searchable],
      );
    }
    const [storedItems] = await connection.query<any[]>('SELECT COUNT(*) total FROM licitacion_items WHERE codigo_externo=?', [code]);
    const totalItems = Number(storedItems[0]?.total) || 0;
    await connection.execute(
      'UPDATE licitacion_enrichment SET estado=?,total_partidas=?,ultimo_error=NULL,proximo_reintento=NULL,finished_at=UTC_TIMESTAMP() WHERE codigo_externo=?',
      [items.length ? 'completed' : 'empty', totalItems, code],
    );
    await connection.commit();
    clearSearchCache();
    return totalItems;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function indexOfficialDetail(code: string, detail: Record<string, any>) {
  await pool.execute("INSERT IGNORE INTO licitacion_enrichment (codigo_externo,estado) VALUES (?,'pending')", [code]);
  await storeDetail(code, detail);
}

async function processQueueUnlocked() {
  while (true) {
    const [pilotRows] = await pool.query<any[]>('SELECT estado,lote_actual FROM licitacion_enrichment_pilot WHERE id=1');
    const pilot = pilotRows[0];
    if (pilot && ['paused','blocked_auth'].includes(String(pilot.estado))) return;
    const batch = pilot?.estado === 'running' && pilot.lote_actual != null ? Number(pilot.lote_actual) : null;
    const [rows] = batch == null
      ? await pool.query<any[]>(
        `SELECT codigo_externo FROM licitacion_enrichment
         WHERE estado='pending' AND (proximo_reintento IS NULL OR proximo_reintento<=UTC_TIMESTAMP())
         ORDER BY updated_at,codigo_externo LIMIT 1`,
      )
      : await pool.query<any[]>(
        `SELECT i.codigo_externo FROM licitacion_enrichment_pilot_items i
         JOIN licitacion_enrichment e ON e.codigo_externo=i.codigo_externo
         WHERE i.lote=? AND i.estado='queued' AND e.estado='pending'
           AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP())
         ORDER BY i.codigo_externo LIMIT 1`, [batch],
      );
    if (!rows[0] && batch != null) {
      await finishPilotBatch(batch);
      return;
    }
    if (!rows[0]) return;
    const code = String(rows[0].codigo_externo);
    const [claim] = await pool.execute<any>(
      `UPDATE licitacion_enrichment SET estado='running',intentos=intentos+1,started_at=UTC_TIMESTAMP(),ultimo_error=NULL
       WHERE codigo_externo=? AND estado='pending'`, [code],
    );
    if (!claim.affectedRows) continue;
    if (batch != null) await pool.execute(
      "UPDATE licitacion_enrichment_pilot_items SET estado='running',iniciado_at=COALESCE(iniciado_at,UTC_TIMESTAMP()) WHERE codigo_externo=? AND lote=? AND estado='queued'",
      [code,batch],
    );
    const started = Date.now();
    try {
      const detail = await getByCode(code);
      const fetchedItems = await storeDetail(code, detail as unknown as Record<string, any>);
      if (batch != null) {
        const [itemRows] = await pool.query<any[]>('SELECT COUNT(*) count FROM licitacion_items WHERE codigo_externo=?',[code]);
        await pool.execute(
          `UPDATE licitacion_enrichment_pilot_items SET estado=?,partidas_despues=?,partidas_nuevas=GREATEST(?-partidas_antes,0),codigo_error=NULL,finalizado_at=UTC_TIMESTAMP(),duracion_ms=? WHERE codigo_externo=? AND lote=?`,
          [fetchedItems?'completed':'empty',Number(itemRows[0]?.count)||0,Number(itemRows[0]?.count)||0,Date.now()-started,code,batch],
        );
      }
    } catch (error) {
      const codeOfError = failureCode(error);
      const [attemptRows] = await pool.query<any[]>('SELECT intentos FROM licitacion_enrichment WHERE codigo_externo=?', [code]);
      const attempts = Number(attemptRows[0]?.intentos ?? 1);
      const permanent = Boolean(error && typeof error === 'object' && 'permanent' in error && (error as { permanent: unknown }).permanent === true);
      const canRetry = attempts < 4 && !permanent;
      const delayMinutes = Math.min(60, 2 ** attempts);
      await pool.execute(
        `UPDATE licitacion_enrichment SET estado='failed',ultimo_error=?,proximo_reintento=?,finished_at=UTC_TIMESTAMP()
         WHERE codigo_externo=?`,
        [codeOfError, canRetry ? new Date(Date.now() + delayMinutes * 60_000) : null, code],
      );
      if (batch != null) {
        await pool.execute("UPDATE licitacion_enrichment_pilot_items SET estado='failed',codigo_error=?,finalizado_at=UTC_TIMESTAMP(),duracion_ms=? WHERE codigo_externo=? AND lote=?",[codeOfError,Date.now()-started,code,batch]);
        const status=Number((error as any)?.status);
        if(status===401||status===403){
          await pool.execute("UPDATE licitacion_enrichment_pilot SET estado='blocked_auth',ultimo_mensaje='Autenticación rechazada por Mercado Público' WHERE id=1");
          await pool.execute("UPDATE licitacion_enrichment_pilot_batches SET estado='blocked_auth' WHERE lote=?",[batch]);
          return;
        }
      }
    }
  }
}

async function processQueue() {
  const connection = await pool.getConnection();
  let acquired = false;
  try {
    const [rows] = await connection.query<any[]>("SELECT GET_LOCK('oportuna_enrichment_worker',0) acquired");
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) return;
    await processQueueUnlocked();
  } finally {
    if (acquired) await connection.query("SELECT RELEASE_LOCK('oportuna_enrichment_worker')");
    connection.release();
  }
}

async function finishPilotBatch(batch:number) {
  const [[remaining], [counts]] = await Promise.all([
    pool.query<any[]>("SELECT COUNT(*) count FROM licitacion_enrichment_pilot_items WHERE lote=? AND estado IN ('queued','running')",[batch]),
    pool.query<any[]>("SELECT SUM(estado='failed') failed FROM licitacion_enrichment_pilot_items WHERE lote=?",[batch]),
  ]);
  if(Number(remaining[0]?.count)>0)return;
  const metrics=await enrichmentMetrics();
  const [requests]=await pool.query<any[]>('SELECT detail_requests FROM mercado_publico_metrics WHERE id=1');
  const [pilotRows]=await pool.query<any[]>('SELECT estado,total_programado,limite_total FROM licitacion_enrichment_pilot WHERE id=1');
  const [batchRows]=await pool.query<any[]>('SELECT solicitudes_iniciales,iniciado_at FROM licitacion_enrichment_pilot_batches WHERE lote=?',[batch]);
  const current=pilotRows[0];
  const blocked=current?.estado==='blocked_auth';
  const batchState=blocked?'blocked_auth':Number(counts[0]?.failed)>0?'completed_with_errors':'completed';
  await pool.execute(
    `UPDATE licitacion_enrichment_pilot_batches SET estado=?,cobertura_final=?,solicitudes_finales=?,finalizado_at=UTC_TIMESTAMP(),duracion_ms=TIMESTAMPDIFF(MICROSECOND,iniciado_at,UTC_TIMESTAMP()) DIV 1000 WHERE lote=?`,
    [batchState,metrics.coveragePercent,Number(requests[0]?.detail_requests)||0,batch],
  );
  if(blocked)return;
  const complete=Number(current?.total_programado)>=Number(current?.limite_total);
  await pool.execute("UPDATE licitacion_enrichment_pilot SET estado=?,lote_actual=NULL,ultimo_mensaje=? WHERE id=1",[complete?'complete':'ready',Number(counts[0]?.failed)>0?'Lote terminado con errores; puedes reintentar los fallidos elegibles.':'Lote terminado. El siguiente requiere inicio manual.']);
}

function kickWorker() {
  const config = loadRuntimeConfig();
  if (!config.enrichmentWorkerEnabled || !['all','enrichment-worker'].includes(config.processRole)) return;
  if (worker) return;
  worker = processQueue().catch((error) => {
    console.warn(`[enrichment] cola interrumpida; tipo=${error instanceof Error ? error.name : 'error'}`);
  }).finally(() => { worker = null; });
}

let enrichmentPoller: ReturnType<typeof setInterval> | null = null;
export function startEnrichmentWorker() {
  const config = loadRuntimeConfig();
  if (!['all','enrichment-worker'].includes(config.processRole) || !config.enrichmentWorkerEnabled || enrichmentPoller) return;
  enrichmentPoller = setInterval(kickWorker, 5000);
  kickWorker();
}

export async function enqueueEnrichment(codes: string[]) {
  const unique = [...new Set(codes)].slice(0, 10);
  let accepted = 0;
  for (const code of unique) {
    const [rows] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_externo=? LIMIT 1', [code]);
    if (!rows[0]) continue;
    const [result] = await pool.execute<any>(
      `INSERT INTO licitacion_enrichment (codigo_externo,estado) VALUES (?,'pending')
       ON DUPLICATE KEY UPDATE estado=IF((estado='failed' AND intentos<4 AND (proximo_reintento IS NULL OR proximo_reintento<=UTC_TIMESTAMP())) OR (estado IN ('completed','empty') AND updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)),'pending',estado),
       ultimo_error=IF(estado='pending',NULL,ultimo_error)`, [code],
    );
    if (result.affectedRows > 0) accepted++;
  }
  kickWorker();
  return { accepted, requested: unique.length };
}

export async function findPriorityCandidates(limit=10) {
  const max=Math.max(1,Math.min(10,limit));
  const [rows]=await pool.query<any[]>(
    `SELECT l.codigo_externo FROM licitaciones l
     LEFT JOIN licitacion_enrichment e ON e.codigo_externo=l.codigo_externo
     LEFT JOIN licitacion_search_interest si ON si.codigo_externo=l.codigo_externo
     WHERE l.codigo_estado=5 AND l.fecha_cierre>=UTC_TIMESTAMP()
       AND l.fecha_cierre<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY)
       AND (e.codigo_externo IS NULL
         OR (e.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP()))
         OR (e.estado IN ('completed','empty') AND e.updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)))
       AND (si.last_seen_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)
         OR LOWER(COALESCE(l.nombre,'')) REGEXP 'adquisicion|convenio|suministro|insumos|varios|equipamiento|equipos|maquinaria|servicio integral')
     ORDER BY l.fecha_cierre ASC,si.last_seen_at IS NULL,si.last_seen_at DESC,
       (LOWER(COALESCE(l.nombre,'')) REGEXP 'adquisicion|convenio|suministro|insumos|varios|equipamiento|equipos|maquinaria|servicio integral') DESC,
       e.updated_at IS NULL,e.updated_at ASC,l.codigo_externo LIMIT ?`,[max],
  );
  return rows.map(row=>String(row.codigo_externo));
}

export async function enrichmentPilotStatus() {
  const [[pilotRows],[batchRows],[itemRows],[requestRows],[resultRows]]=await Promise.all([
    pool.query<any[]>('SELECT estado,total_programado,limite_total,tamano_lote,lote_actual,ultimo_mensaje FROM licitacion_enrichment_pilot WHERE id=1'),
    pool.query<any[]>(`SELECT lote,estado,estrategia,cantidad,cobertura_inicial,cobertura_final,solicitudes_iniciales,solicitudes_finales,iniciado_at,finalizado_at,duracion_ms FROM licitacion_enrichment_pilot_batches ORDER BY lote DESC LIMIT 1`),
    pool.query<any[]>(`SELECT COUNT(*) consulted,SUM(estado IN ('completed','empty')) fetched,SUM(estado='completed') with_items,SUM(estado='empty') without_items,SUM(partidas_nuevas) new_items,SUM(estado='failed') errors,SUM(estado='failed' AND EXISTS (SELECT 1 FROM licitacion_enrichment e WHERE e.codigo_externo=licitacion_enrichment_pilot_items.codigo_externo AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP()))) retryable_errors,SUM(estado IN ('queued','running')) pending,AVG(duracion_ms) avg_ms FROM licitacion_enrichment_pilot_items`),
    pool.query<any[]>('SELECT detail_requests FROM mercado_publico_metrics WHERE id=1'),
    pool.query<any[]>(`SELECT i.codigo_externo code,l.nombre title,i.estado status,i.codigo_error error,i.partidas_nuevas newItems,
        (i.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP())) retryable
      FROM licitacion_enrichment_pilot_items i JOIN licitaciones l USING(codigo_externo)
      LEFT JOIN licitacion_enrichment e USING(codigo_externo)
      WHERE i.lote=(SELECT MAX(lote) FROM licitacion_enrichment_pilot_batches)
      ORDER BY i.codigo_externo LIMIT 10`),
  ]);
  const pilot=pilotRows[0]??{};const last=batchRows[0]??null;const items=itemRows[0]??{};const requests=Number(requestRows[0]?.detail_requests)||0;
  const [totals]=await pool.query<any[]>(`SELECT COALESCE(SUM(COALESCE(solicitudes_finales,?)-solicitudes_iniciales),0) requests,COALESCE(SUM(duracion_ms),0) duration FROM licitacion_enrichment_pilot_batches`,[requests]);
  const status=String(pilot.estado??'idle');
  return {status,scheduledTotal:Number(pilot.total_programado)||0,maxTotal:Number(pilot.limite_total)||100,batchSize:Number(pilot.tamano_lote)||10,remainingCapacity:Math.max(0,(Number(pilot.limite_total)||100)-(Number(pilot.total_programado)||0)),currentBatch:pilot.lote_actual==null?null:Number(pilot.lote_actual),message:pilot.ultimo_mensaje??null,consulted:Number(items.consulted)||0,fetched:Number(items.fetched)||0,withItems:Number(items.with_items)||0,withoutItems:Number(items.without_items)||0,newItems:Number(items.new_items)||0,errors:Number(items.errors)||0,retryableErrors:Number(items.retryable_errors)||0,pending:Number(items.pending)||0,averageDurationMs:Math.round(Number(items.avg_ms)||0),effectiveRequests:Number(totals[0]?.requests)||0,totalBatchDurationMs:Number(totals[0]?.duration)||0,lastBatch:last?{number:Number(last.lote),status:last.estado,strategy:last.estrategia,count:Number(last.cantidad),coverageBefore:Number(last.cobertura_inicial),coverageAfter:last.cobertura_final==null?null:Number(last.cobertura_final),requests:Number(last.solicitudes_finales==null?requests-Number(last.solicitudes_iniciales):Number(last.solicitudes_finales)-Number(last.solicitudes_iniciales)),startedAt:last.iniciado_at,finishedAt:last.finalizado_at,durationMs:last.duracion_ms==null?null:Number(last.duracion_ms),results:resultRows.map((row:any)=>({code:String(row.code),title:String(row.title),status:String(row.status),error:row.error??null,newItems:Number(row.newItems)||0,retryable:Boolean(row.retryable)}))}:null};
}

export async function startEnrichmentPilotBatch(strategy:'general'|'thematic'='general',thematicCandidates?:EnrichmentCandidate[]) {
  const connection=await pool.getConnection();let batchNumber=0;let selected:any[]=[];
  try{
    await connection.beginTransaction();
    const [pilotRows]=await connection.query<any[]>('SELECT * FROM licitacion_enrichment_pilot WHERE id=1 FOR UPDATE');const pilot=pilotRows[0];
    if(!pilot)throw new Error('La migración del piloto no está aplicada.');
    if(['running','paused','blocked_auth'].includes(String(pilot.estado)))throw new Error('Hay un lote activo o detenido que debes continuar o reintentar primero.');
    const remaining=Math.max(0,Math.min(100,Number(pilot.limite_total))-Number(pilot.total_programado));
    if(!remaining){await connection.execute("UPDATE licitacion_enrichment_pilot SET estado='complete',ultimo_mensaje='Se alcanzó el límite del piloto.' WHERE id=1");await connection.commit();return {accepted:0,batch:null,reason:'limit'};}
    const limit=Math.min(10,Number(pilot.tamano_lote)||10,remaining);
    if(strategy==='thematic'){
      if(!thematicCandidates?.length)throw new Error('Actualiza la vista previa antes de preparar un lote temático.');
      const requested=thematicCandidates.slice(0,limit);
      const codes=requested.map(item=>item.code);
      const [rows]=await connection.query<any[]>(
        `SELECT l.codigo_externo FROM licitaciones l
         LEFT JOIN licitacion_enrichment e USING(codigo_externo)
         LEFT JOIN licitacion_enrichment_pilot_items pi USING(codigo_externo)
         WHERE l.codigo_externo IN (?) AND l.codigo_estado=5
           AND l.fecha_cierre>=UTC_TIMESTAMP() AND l.fecha_cierre<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY)
           AND pi.codigo_externo IS NULL
           AND ((e.codigo_externo IS NULL AND NOT EXISTS (SELECT 1 FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo))
             OR (e.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP()))
             OR (e.estado IN ('completed','empty') AND e.updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)))`,[codes]);
      const eligible=new Set(rows.map((row:any)=>String(row.codigo_externo)));
      if(eligible.size!==codes.length)throw new Error('Una o más candidatas ya no cumplen los criterios; actualiza la vista previa.');
      selected=requested.map(item=>({code:item.code,score:item.score??0,level:item.selectionType==='investigation'?'exploratory':item.level==='high'?'exact':'semantic',reasons:[item.reason],queries:[{productName:item.productName,matchedSources:item.matchedSources}]}));
    } else {
      const [candidates]=await connection.query<any[]>(
        `SELECT l.codigo_externo,si.search_count,l.fecha_cierre FROM licitaciones l
         LEFT JOIN licitacion_enrichment e ON e.codigo_externo=l.codigo_externo
         LEFT JOIN licitacion_search_interest si ON si.codigo_externo=l.codigo_externo AND si.last_seen_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)
         LEFT JOIN licitacion_enrichment_pilot_items pi ON pi.codigo_externo=l.codigo_externo
         WHERE l.codigo_estado=5 AND (l.fecha_cierre IS NULL OR l.fecha_cierre>=UTC_TIMESTAMP()) AND pi.codigo_externo IS NULL
           AND (e.codigo_externo IS NULL OR (e.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP())))
           AND NOT EXISTS (SELECT 1 FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo)
           AND (si.last_seen_at IS NOT NULL OR LOWER(COALESCE(l.nombre,'')) REGEXP 'adquisicion|convenio|suministro|insumos|varios|equipamiento|equipos|maquinaria|servicio integral')
         ORDER BY l.fecha_cierre IS NULL,l.fecha_cierre ASC,si.last_seen_at IS NULL,si.last_seen_at DESC,l.codigo_externo LIMIT ?`,[limit]);
      selected=candidates.map((row:any)=>{const days=row.fecha_cierre?Math.max(0,Math.ceil((new Date(row.fecha_cierre).getTime()-Date.now())/86_400_000)):90;const interest=Number(row.search_count)||0;return {code:String(row.codigo_externo),score:Math.min(100,Math.max(1,100-days+Math.min(8,interest))),level:'exploratory',reasons:[row.fecha_cierre?`Prioridad general: cierre en ${days} día(s).`:'Prioridad general: sin fecha de cierre registrada.','Licitación activa sin partidas indexadas.',...(interest?[`Apareció en ${interest} resultados de búsquedas recientes.`]:[])],queries:[]};});
    }
    const [batchRows]=await connection.query<any[]>('SELECT COALESCE(MAX(lote),0)+1 next_batch FROM licitacion_enrichment_pilot_batches');batchNumber=Number(batchRows[0].next_batch);
    const [metrics]=await connection.query<any[]>(`SELECT (SELECT COUNT(*) FROM licitaciones WHERE codigo_estado=5 AND (fecha_cierre IS NULL OR fecha_cierre>=UTC_TIMESTAMP())) active,(SELECT COUNT(DISTINCT l.codigo_externo) FROM licitaciones l JOIN licitacion_items i ON i.codigo_externo=l.codigo_externo WHERE l.codigo_estado=5 AND (l.fecha_cierre IS NULL OR l.fecha_cierre>=UTC_TIMESTAMP())) with_items,(SELECT detail_requests FROM mercado_publico_metrics WHERE id=1) requests`);
    const coverage=Number(metrics[0].active)?Math.round(Number(metrics[0].with_items)/Number(metrics[0].active)*10000)/100:0;
    await connection.execute(`INSERT INTO licitacion_enrichment_pilot_batches (lote,estado,estrategia,cantidad,cobertura_inicial,solicitudes_iniciales,iniciado_at) VALUES (?,'running',?,?,?, ?,UTC_TIMESTAMP())`,[batchNumber,strategy,selected.length,coverage,Number(metrics[0].requests)||0]);
    for(const item of selected){
      await connection.execute(`INSERT INTO licitacion_enrichment_pilot_items (codigo_externo,lote,estado,puntaje_interno,nivel_evidencia,motivos_json,consultas_json) VALUES (?,?,'queued',?,?,?,?)`,[item.code,batchNumber,item.score,item.level,JSON.stringify(item.reasons),JSON.stringify(item.queries)]);
      await connection.execute(`INSERT INTO licitacion_enrichment (codigo_externo,estado) VALUES (?,'pending') ON DUPLICATE KEY UPDATE estado='pending',ultimo_error=NULL,proximo_reintento=NULL`,[item.code]);
    }
    await connection.execute("UPDATE licitacion_enrichment_pilot SET estado='running',total_programado=total_programado+?,lote_actual=?,ultimo_mensaje=NULL WHERE id=1",[selected.length,batchNumber]);
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  kickWorker();return {accepted:selected.length,batch:batchNumber,strategy};
}

export async function pauseEnrichmentPilot() {
  const [result]=await pool.execute<any>("UPDATE licitacion_enrichment_pilot SET estado='paused',ultimo_mensaje='Pausa solicitada; la solicitud en curso terminará antes de detenerse.' WHERE id=1 AND estado='running'");
  if(result.affectedRows)await pool.execute("UPDATE licitacion_enrichment_pilot_batches SET estado='paused' WHERE lote=(SELECT lote_actual FROM licitacion_enrichment_pilot WHERE id=1)");
  return {paused:Boolean(result.affectedRows)};
}

export async function resumeEnrichmentPilot() {
  const [result]=await pool.execute<any>("UPDATE licitacion_enrichment_pilot SET estado='running',ultimo_mensaje=NULL WHERE id=1 AND estado='paused'");
  if(result.affectedRows){await pool.execute("UPDATE licitacion_enrichment_pilot_batches SET estado='running' WHERE lote=(SELECT lote_actual FROM licitacion_enrichment_pilot WHERE id=1)");kickWorker();}
  return {resumed:Boolean(result.affectedRows)};
}

export async function retryEnrichmentPilotFailures() {
  const connection=await pool.getConnection();let accepted=0;let batch=0;
  try{
    await connection.beginTransaction();const [pilotRows]=await connection.query<any[]>('SELECT * FROM licitacion_enrichment_pilot WHERE id=1 FOR UPDATE');const pilot=pilotRows[0];
    if(['running','paused'].includes(String(pilot?.estado)))throw new Error('Pausa el lote antes de reintentar errores.');
    const [batchRows]=await connection.query<any[]>(`SELECT i.lote FROM licitacion_enrichment_pilot_items i JOIN licitacion_enrichment e USING(codigo_externo) WHERE i.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP()) ORDER BY i.lote LIMIT 1`);batch=Number(batchRows[0]?.lote)||0;
    if(!batch){await connection.commit();return {accepted:0,batch:null};}
    const [failed]=await connection.query<any[]>(`SELECT i.codigo_externo FROM licitacion_enrichment_pilot_items i JOIN licitacion_enrichment e USING(codigo_externo) WHERE i.lote=? AND i.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP())`,[batch]);
    for(const row of failed){const code=String(row.codigo_externo);await connection.execute("UPDATE licitacion_enrichment SET estado='pending',ultimo_error=NULL,proximo_reintento=NULL WHERE codigo_externo=? AND estado='failed' AND intentos<4",[code]);await connection.execute("UPDATE licitacion_enrichment_pilot_items SET estado='queued',codigo_error=NULL,finalizado_at=NULL WHERE codigo_externo=? AND lote=?",[code,batch]);accepted++;}
    if(accepted){await connection.execute("UPDATE licitacion_enrichment_pilot SET estado='running',lote_actual=?,ultimo_mensaje=NULL WHERE id=1",[batch]);await connection.execute("UPDATE licitacion_enrichment_pilot_batches SET estado='running',finalizado_at=NULL,duracion_ms=NULL,solicitudes_finales=NULL,cobertura_final=NULL WHERE lote=?",[batch]);}
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  if(accepted)kickWorker();return {accepted,batch:batch||null};
}

export async function previewEnrichmentCandidates(products: PreviewProduct[], profileExclusions: string[] = [], limit = 10) {
  const activeProducts = products.filter(product => product.activo !== false);
  if (!activeProducts.length) {
    return { eligibleCandidates: 0, candidates: [], catalogProductCount: 0, coverage: await enrichmentMetrics() };
  }
  const [rows] = await pool.query<any[]>(
    `SELECT l.codigo_externo code,l.nombre title,l.organismo,l.fecha_cierre closeAt,l.monto_estimado amount,l.moneda currency,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Descripcion')),JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.DescripcionLicitacion')),JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.DescripcionProceso')),'') description,
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Categoria')),JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.CategoriaNombre')),JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Rubro')),JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.CodigoCategoriaNombre')),'') category,
       COALESCE((SELECT GROUP_CONCAT(DISTINCT CONCAT_WS(' ',li.nombre,li.descripcion,li.categoria) SEPARATOR ' ') FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo),'') itemText,
       (SELECT COUNT(*) FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo) itemCount,
       e.estado detailStatus,e.updated_at detailUpdatedAt
     FROM licitaciones l
     LEFT JOIN licitacion_enrichment e ON e.codigo_externo=l.codigo_externo
     LEFT JOIN licitacion_enrichment_pilot_items pi ON pi.codigo_externo=l.codigo_externo
     WHERE l.codigo_estado=5 AND l.fecha_cierre>=UTC_TIMESTAMP()
       AND l.fecha_cierre<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY)
       AND pi.codigo_externo IS NULL
       AND NOT EXISTS (SELECT 1 FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo)
       AND (
         e.codigo_externo IS NULL
         OR (e.estado='failed' AND e.intentos<4 AND (e.proximo_reintento IS NULL OR e.proximo_reintento<=UTC_TIMESTAMP()))
       )
     ORDER BY l.fecha_cierre ASC,l.codigo_externo`,
  );
  const ranked = rankEnrichmentCandidates(rows as PreviewListingRow[], activeProducts, profileExclusions, Date.now(), limit);
  return { ...ranked, catalogProductCount: activeProducts.length, coverage: await enrichmentMetrics() };
}

export async function enrichmentMetrics() {
  const [rows]=await pool.query<any[]>(
    `SELECT
       (SELECT COUNT(*) FROM licitaciones l WHERE l.codigo_estado=5 AND (l.fecha_cierre IS NULL OR l.fecha_cierre>=UTC_TIMESTAMP())) active_listings,
       (SELECT COUNT(*) FROM licitaciones l WHERE l.codigo_estado=5 AND (l.fecha_cierre IS NULL OR l.fecha_cierre>=UTC_TIMESTAMP()) AND EXISTS (SELECT 1 FROM licitacion_items i WHERE i.codigo_externo=l.codigo_externo)) active_with_items,
       (SELECT COUNT(*) FROM licitacion_enrichment e WHERE e.estado IN ('completed','empty')) details_fetched,
       (SELECT COUNT(*) FROM licitacion_enrichment e WHERE e.estado='completed' AND e.total_partidas>0) enriched_with_items,
       (SELECT COUNT(*) FROM licitacion_items) indexed_items,
       (SELECT COUNT(*) FROM licitacion_enrichment e WHERE e.estado IN ('pending','running')) pending,
       (SELECT COUNT(*) FROM licitacion_enrichment e WHERE e.estado='failed') failed,
       (SELECT COALESCE(detail_requests,0) FROM mercado_publico_metrics WHERE id=1) detail_requests,
       (SELECT COUNT(*) FROM licitacion_enrichment e JOIN licitaciones l ON l.codigo_externo=e.codigo_externo
          WHERE l.codigo_estado=5 AND l.fecha_cierre>=UTC_TIMESTAMP() AND l.fecha_cierre<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY)
            AND e.updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)) pending_updates,
       (SELECT COUNT(*) FROM licitacion_search_interest WHERE last_seen_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY)) recent_search_listings`,
  );
  const row=rows[0];const activeListings=Number(row.active_listings)||0;const activeWithItems=Number(row.active_with_items)||0;
  return {activeListings,activeWithItems,coveragePercent:activeListings?Math.round(activeWithItems/activeListings*10000)/100:0,detailsFetched:Number(row.details_fetched)||0,enrichedWithItems:Number(row.enriched_with_items)||0,indexedItems:Number(row.indexed_items)||0,pending:Number(row.pending)||0,failed:Number(row.failed)||0,detailRequests:Number(row.detail_requests)||0,pendingUpdates:Number(row.pending_updates)||0,recentSearchListings:Number(row.recent_search_listings)||0};
}

export async function enrichmentStatus(codes?: string[]) {
  if (codes?.length) {
    const unique = [...new Set(codes)].slice(0, 50);
    if (!unique.length) return [];
    const [rows] = await pool.query<any[]>(
      `SELECT codigo_externo code,estado status,total_partidas itemCount,ultimo_error error,intentos attempts,updated_at updatedAt
       FROM licitacion_enrichment WHERE codigo_externo IN (${unique.map(() => '?').join(',')})`, unique,
    );
    return rows;
  }
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) total, SUM(estado='completed') completed, SUM(estado='empty') without_items,
      SUM(estado='pending' OR estado='running') active,SUM(estado='failed') failed,
      SUM(total_partidas) items FROM licitacion_enrichment`,
  );
  return {...rows[0],...(await enrichmentMetrics())};
}

export async function recoverEnrichmentQueue() {
  if (!['all','enrichment-worker'].includes(loadRuntimeConfig().processRole)) return;
  const connection = await pool.getConnection();
  let acquired = false;
  try {
    const [locks] = await connection.query<any[]>("SELECT GET_LOCK('oportuna_enrichment_worker',0) acquired");
    acquired = Number(locks[0]?.acquired) === 1;
    if (!acquired) return;
  const [stored] = await pool.query<any[]>(
    `SELECT l.codigo_externo,l.payload_json FROM licitaciones l
     LEFT JOIN licitacion_enrichment e ON e.codigo_externo=l.codigo_externo
     WHERE e.codigo_externo IS NULL AND JSON_CONTAINS_PATH(l.payload_json,'one','$.Items.Listado') LIMIT 100`,
  );
  for (const row of stored) {
    const code = String(row.codigo_externo);
    const detail = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
    await pool.execute("INSERT IGNORE INTO licitacion_enrichment (codigo_externo,estado) VALUES (?,'pending')", [code]);
    await storeDetail(code, detail);
  }
  await pool.execute("UPDATE licitacion_enrichment SET estado='pending' WHERE estado='running'");
  // Reconcile the durable batch item with the durable detail state before a worker resumes.
  // A crash may happen after storeDetail commits but before the batch row is finalized.
  await pool.execute(
    `UPDATE licitacion_enrichment_pilot_items pi
     JOIN licitacion_enrichment e ON e.codigo_externo=pi.codigo_externo
     SET pi.estado=CASE e.estado
           WHEN 'completed' THEN 'completed'
           WHEN 'empty' THEN 'empty'
           WHEN 'failed' THEN 'failed'
           ELSE 'queued'
         END,
         pi.partidas_despues=CASE WHEN e.estado IN ('completed','empty') THEN e.total_partidas ELSE pi.partidas_despues END,
         pi.partidas_nuevas=CASE WHEN e.estado IN ('completed','empty') THEN GREATEST(e.total_partidas-pi.partidas_antes,0) ELSE pi.partidas_nuevas END,
         pi.codigo_error=CASE WHEN e.estado='failed' THEN e.ultimo_error ELSE NULL END,
         pi.finalizado_at=CASE WHEN e.estado IN ('completed','empty','failed') THEN COALESCE(pi.finalizado_at,UTC_TIMESTAMP()) ELSE NULL END
     WHERE pi.estado='running'`,
  );
  } finally {
    if (acquired) await connection.query("SELECT RELEASE_LOCK('oportuna_enrichment_worker')");
    connection.release();
  }
  kickWorker();
}
