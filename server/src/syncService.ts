import pool from './db.js';
import { listByDate, listActive, MercadoPublicoError } from './mercadoPublico.js';
import { parseTenderAmount, tenderAmountUpsertSql } from './tenderAmount.js';
import type { ApiListing } from './types.js';
import { loadRuntimeConfig } from './runtimeConfig.js';

type JobType = 'historica' | 'diaria';
let workerRunning = false;
let pauseRequested = false;
let schedulerTimer: ReturnType<typeof setInterval> | undefined;
let syncWorkerPoller: ReturnType<typeof setInterval> | undefined;
const upsertSql = `INSERT INTO licitaciones (codigo_externo,nombre,codigo_estado,fecha_cierre,fecha_publicacion,organismo,monto_estimado,moneda,payload_json,last_synced_at) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE nombre=COALESCE(VALUES(nombre),nombre),codigo_estado=COALESCE(VALUES(codigo_estado),codigo_estado),fecha_cierre=COALESCE(VALUES(fecha_cierre),fecha_cierre),fecha_publicacion=COALESCE(VALUES(fecha_publicacion),fecha_publicacion),organismo=COALESCE(VALUES(organismo),organismo),${tenderAmountUpsertSql},moneda=COALESCE(VALUES(moneda),moneda),payload_json=JSON_MERGE_PATCH(payload_json,VALUES(payload_json)),last_synced_at=UTC_TIMESTAMP()`;
function toDbDate(value: unknown): string | null { if (typeof value !== 'string' || !value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0,19).replace('T',' '); }
function normalized(row: ApiListing) {
  if (typeof row.CodigoExterno !== 'string' || !row.CodigoExterno.trim()) throw new Error('La API devolvió una licitación sin código externo.');
  const state = row.CodigoEstado == null || row.CodigoEstado === '' ? null : Number(row.CodigoEstado);
  const amount = parseTenderAmount(row.MontoEstimado);
  return [row.CodigoExterno, typeof row.Nombre === 'string' ? row.Nombre : null, Number.isFinite(state) ? state : null,
    toDbDate(row.FechaCierre ?? row.Fechas?.FechaCierre), toDbDate(row.Fechas?.FechaPublicacion ?? row.Fechas?.FechaCreacion),
    typeof row.Comprador?.NombreOrganismo === 'string' ? row.Comprador.NombreOrganismo : null,
    Number.isFinite(amount) ? amount : null, typeof row.Moneda === 'string' ? row.Moneda : null, JSON.stringify(row)];
}
const isoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso: string, count: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+count); return d.toISOString().slice(0,10); };
const compactDate = (iso: string) => iso.slice(8,10)+iso.slice(5,7)+iso.slice(0,4);
const DAILY_CATCHUP_MAX_DAYS = 14;
function santiagoParts(date:Date) { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).reduce<Record<string,string>>((a,p)=>(a[p.type]=p.value,a),{}); }
function santiagoDate(date:Date) { const p=santiagoParts(date);return `${p.year}-${p.month}-${p.day}`; }
function daysBetween(from:string,to:string) { return Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000); }
export function dailySyncPlan(now:Date,lastSuccessfulDate:string|null,maxDays=DAILY_CATCHUP_MAX_DAYS,targetDate=santiagoDate(now)) {
  const from=lastSuccessfulDate?addDays(lastSuccessfulDate,1):addDays(targetDate,-1);
  if(from>targetDate)return null;
  const totalDays=daysBetween(from,targetDate)+1;const to=addDays(from,Math.min(totalDays,maxDays)-1);
  return {dateFrom:from,dateTo:to,totalPendingDays:totalDays,refreshActive:to===targetDate};
}
export function isDailySchedulerDue(now:Date) { const p=santiagoParts(now);return Number(p.hour)*60+Number(p.minute)>=480; }
function chile0800(date:string) {
  const [year,month,day]=date.split('-').map(Number);const target=Date.UTC(year,month-1,day,8,0,0);let candidate=target;
  for(let attempt=0;attempt<5;attempt++){const p=santiagoParts(new Date(candidate));const observed=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));const correction=target-observed;if(!correction)break;candidate+=correction;}
  return new Date(candidate);
}
export function nextSantiagoRun(now:Date) { const p=santiagoParts(now);const localDate=`${p.year}-${p.month}-${p.day}`;const minuteOfDay=Number(p.hour)*60+Number(p.minute);return chile0800(minuteOfDay<480?localDate:addDays(localDate,1)); }
export async function dailySchedulerStatus(now=new Date()) {
  const [[rows]] = await Promise.all([pool.query<any[]>("SELECT DATE_FORMAT(MAX(fecha),'%Y-%m-%d') AS lastSuccessfulDate FROM sync_job_days WHERE estado='completed'")]);
  const plan=dailySyncPlan(now,rows[0]?.lastSuccessfulDate?String(rows[0].lastSuccessfulDate):null);
  const enabled=process.env.SYNC_SCHEDULER_ENABLED==='true';
  const pendingDates=plan?Array.from({length:Math.min(plan.totalPendingDays,DAILY_CATCHUP_MAX_DAYS)},(_,i)=>addDays(plan.dateFrom,i)):[];
  return {enabled,timezone:'America/Santiago',scheduledTime:'08:00',nextRunAt:enabled?nextSantiagoRun(now).toISOString():null,lastSuccessfulDate:rows[0]?.lastSuccessfulDate??null,pendingDates,pendingDays:plan?.totalPendingDays??0,maxDaysPerJob:DAILY_CATCHUP_MAX_DAYS,catchupNeeded:Boolean(plan),additionalCatchupRequired:Boolean(plan&&plan.totalPendingDays>DAILY_CATCHUP_MAX_DAYS)};
}
function safeError(error: unknown) { return error instanceof MercadoPublicoError ? error.message : error instanceof Error ? error.message.slice(0,500) : 'Error inesperado.'; }

export async function startJob(dateFrom: string, dateTo: string, type: JobType = 'historica', manual = false, refreshActive = type === 'diaria', includeDates = true) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) throw new Error('Indica un rango de fechas válido.');
  const span = includeDates ? Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1 : 0;
  if (includeDates&&(!Number.isInteger(span) || span < 1 || span > 366)) throw new Error('El rango debe contener entre 1 y 366 días.');
  const conn = await pool.getConnection();
  let creationLock = false;
  try {
    const [locks] = await conn.query<any[]>("SELECT GET_LOCK('oportuna_sync_job_create',0) acquired");
    creationLock = Number(locks[0]?.acquired) === 1;
    if (!creationLock) throw new Error('Se está iniciando otra sincronización; inténtalo nuevamente.');
    await conn.beginTransaction();
    const [active] = await conn.query<any[]>('SELECT id FROM sync_jobs WHERE estado IN (\'queued\',\'running\',\'paused\') LIMIT 1 FOR UPDATE');
    if (active.length) throw new Error('Ya existe una sincronización pendiente o en curso.');
    const activeRefresh = type === 'diaria' && refreshActive ? 'pending' : 'not_required';
    const [result] = await conn.execute<any>('INSERT INTO sync_jobs (tipo,fecha_inicio,fecha_fin,estado,active_refresh_status,total_dias,started_at) VALUES (?,?,?,\'queued\',?,?,UTC_TIMESTAMP())', [type,dateFrom,dateTo,activeRefresh,span]);
    const id = Number(result.insertId);
    if(includeDates)for (let day = dateFrom; day <= dateTo; day = addDays(day,1)) await conn.execute('INSERT INTO sync_job_days (job_id,fecha) VALUES (?,?)', [id,day]);
    await conn.commit();
    if (manual) void runWorker(id);
    else void runWorker();
    return id;
  } catch (error) { try { await conn.rollback(); } catch { /* transaction might not have started */ } throw error; } finally { if (creationLock) await conn.query("SELECT RELEASE_LOCK('oportuna_sync_job_create')"); conn.release(); }
}
export async function getJob(id?: number) {
  const [jobs] = id ? await pool.query<any[]>('SELECT * FROM sync_jobs WHERE id=?', [id]) : await pool.query<any[]>("SELECT * FROM sync_jobs ORDER BY id DESC LIMIT 1");
  const job = jobs[0]; if (!job) return null;
  const [days] = await pool.query<any[]>("SELECT DATE_FORMAT(fecha,'%Y-%m-%d') fecha,estado,intentos,total_recibidos totalRecibidos,total_insertados totalInsertados,total_actualizados totalActualizados,mensaje_error mensajeError,started_at startedAt,finished_at finishedAt,last_successful_at lastSuccessfulAt FROM sync_job_days WHERE job_id=? ORDER BY fecha", [job.id]);
  return { ...job, id: Number(job.id), total_dias: Number(job.total_dias), dias_completados: Number(job.dias_completados), dias_fallidos: Number(job.dias_fallidos), total_recibidos: Number(job.total_recibidos), total_insertados: Number(job.total_insertados), total_actualizados: Number(job.total_actualizados), days };
}
export async function pauseJob(id: number) {
  const [result] = await pool.execute<any>("UPDATE sync_jobs SET pause_requested=1 WHERE id=? AND estado IN ('queued','running')", [id]);
  if (!result.affectedRows) throw new Error('No hay un proceso activo que se pueda pausar.');
  pauseRequested = true;
}
export async function resumeJob(id: number) {
  const [result] = await pool.execute<any>("UPDATE sync_jobs SET estado='queued',paused_at=NULL,pause_requested=0 WHERE id=? AND estado='paused'", [id]);
  if (!result.affectedRows) throw new Error('El proceso no está pausado.');
  pauseRequested = false; void runWorker(id);
}
export async function retryJob(id: number) {
  const [result] = await pool.execute<any>("UPDATE sync_job_days SET estado='pending',mensaje_error=NULL WHERE job_id=? AND estado='failed'", [id]);
  const [refresh]=await pool.execute<any>("UPDATE sync_jobs SET active_refresh_status='pending' WHERE id=? AND tipo='diaria' AND active_refresh_status='failed'",[id]);
  if (!result.affectedRows&&!refresh.affectedRows) throw new Error('No hay errores para reintentar.');
  await pool.execute("UPDATE sync_jobs SET estado='queued',mensaje_error=NULL,finished_at=NULL WHERE id=? AND estado IN ('completed_with_errors','failed')", [id]);
  pauseRequested = false; void runWorker(id);
}
async function runDay(jobId: number, date: string, type:JobType) {
  const dateApi = compactDate(date);
  const [run] = await pool.execute<any>("INSERT INTO sync_runs (job_id,fecha_consultada,estado,source) VALUES (?,?, 'en_progreso',?)", [jobId,date,type==='diaria'?'daily':'historical']);
  const runId = Number(run.insertId);
  await pool.execute("UPDATE sync_job_days SET estado='in_progress',intentos=intentos+1,started_at=COALESCE(started_at,UTC_TIMESTAMP()),mensaje_error=NULL WHERE job_id=? AND fecha=?", [jobId,date]);
  try {
    const rows = await listByDate(dateApi); let inserted=0; let updated=0;
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); for (const row of rows) { const [r] = await conn.execute<any>(upsertSql, normalized(row)); if (r.affectedRows === 1) inserted++; else updated++; } await conn.commit(); }
    catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    await pool.execute("UPDATE sync_runs SET estado='completada',total_recibidos=?,total_insertados=?,total_actualizados=?,finished_at=UTC_TIMESTAMP() WHERE id=?",[rows.length,inserted,updated,runId]);
    await pool.execute("UPDATE sync_job_days SET estado='completed',total_recibidos=?,total_insertados=?,total_actualizados=?,mensaje_error=NULL,finished_at=UTC_TIMESTAMP(),last_successful_at=UTC_TIMESTAMP() WHERE job_id=? AND fecha=?",[rows.length,inserted,updated,jobId,date]);
  } catch(error) {
    const message=safeError(error);
    await pool.execute("UPDATE sync_runs SET estado='fallida',mensaje_error=?,finished_at=UTC_TIMESTAMP() WHERE id=?",[message,runId]);
    await pool.execute("UPDATE sync_job_days SET estado='failed',mensaje_error=?,finished_at=UTC_TIMESTAMP() WHERE job_id=? AND fecha=?",[message,jobId,date]);
    // Once the configured retries are exhausted, stop the daily job. Continuing
    // would spend the same retry budget on later dates while the API is offline.
    throw error;
  }
}
async function refreshActive(jobId: number) {
  const [run]=await pool.execute<any>("INSERT INTO sync_runs (job_id,fecha_consultada,estado,source) VALUES (?,?,'en_progreso','active_refresh')",[jobId,isoToday()]); const runId=Number(run.insertId);
  try {
    const rows=await listActive(); let inserted=0;let updated=0;
    const conn=await pool.getConnection(); try{await conn.beginTransaction();for(const row of rows){const [r]=await conn.execute<any>(upsertSql,normalized(row));if(r.affectedRows===1)inserted++;else updated++;}await conn.commit();}catch(e){await conn.rollback();throw e;}finally{conn.release();}
    await pool.execute("UPDATE sync_runs SET estado='completada',total_recibidos=?,total_insertados=?,total_actualizados=?,finished_at=UTC_TIMESTAMP() WHERE id=?",[rows.length,inserted,updated,runId]);
    await pool.execute("UPDATE sync_jobs SET active_refresh_status='completed',total_recibidos=total_recibidos+?,total_insertados=total_insertados+?,total_actualizados=total_actualizados+? WHERE id=?",[rows.length,inserted,updated,jobId]);
  }catch(e){const message=safeError(e);await pool.execute("UPDATE sync_runs SET estado='fallida',mensaje_error=?,finished_at=UTC_TIMESTAMP() WHERE id=?",[message,runId]);await pool.execute("UPDATE sync_jobs SET active_refresh_status='failed',mensaje_error=? WHERE id=?",[message,jobId]);throw e;}
}
async function runWorker(manualJobId?: number) {
  if (!manualJobId && !['all','sync-worker'].includes(loadRuntimeConfig().processRole)) return;
  if(workerRunning)return;workerRunning=true;
  const conn=await pool.getConnection(); let gotLock=false;
  try{
    const [locks]=await conn.query<any[]>("SELECT GET_LOCK('oportuna_sync_worker',0) acquired");if(!Number(locks[0]?.acquired)){workerRunning=false;return;}gotLock=true;
    while(true){
      const [jobs]=manualJobId
        ? await pool.query<any[]>("SELECT * FROM sync_jobs WHERE id=? AND estado IN ('queued','running') LIMIT 1",[manualJobId])
        : await pool.query<any[]>("SELECT * FROM sync_jobs WHERE estado IN ('queued','running') ORDER BY id LIMIT 1");const job=jobs[0];if(!job)break;
      await pool.execute("UPDATE sync_jobs SET estado='running',started_at=COALESCE(started_at,UTC_TIMESTAMP()) WHERE id=?",[job.id]);
      if(pauseRequested){await pool.execute("UPDATE sync_jobs SET estado='paused',pause_requested=0,paused_at=UTC_TIMESTAMP() WHERE id=?",[job.id]);pauseRequested=false;break;}
      const [days]=await pool.query<any[]>("SELECT DATE_FORMAT(fecha,'%Y-%m-%d') fecha FROM sync_job_days WHERE job_id=? AND estado='pending' ORDER BY fecha LIMIT 1",[job.id]);
      if(days.length){
        const date=days[0].fecha;
        try{await runDay(Number(job.id),date,job.tipo);}catch(e){await pool.execute("UPDATE sync_jobs SET estado='failed',mensaje_error=?,finished_at=UTC_TIMESTAMP() WHERE id=?",[safeError(e),job.id]);break;}
        await pool.execute("UPDATE sync_jobs SET dias_completados=(SELECT COUNT(*) FROM sync_job_days WHERE job_id=? AND estado='completed'),dias_fallidos=(SELECT COUNT(*) FROM sync_job_days WHERE job_id=? AND estado='failed'),total_recibidos=(SELECT COALESCE(SUM(total_recibidos),0) FROM sync_job_days WHERE job_id=?),total_insertados=(SELECT COALESCE(SUM(total_insertados),0) FROM sync_job_days WHERE job_id=?),total_actualizados=(SELECT COALESCE(SUM(total_actualizados),0) FROM sync_job_days WHERE job_id=?) WHERE id=?",[job.id,job.id,job.id,job.id,job.id,job.id]);
        if(pauseRequested){await pool.execute("UPDATE sync_jobs SET estado='paused',pause_requested=0,paused_at=UTC_TIMESTAMP() WHERE id=?",[job.id]);pauseRequested=false;break;}
        continue;
      }
      if(job.tipo==='diaria'&&job.active_refresh_status==='pending'){
        try{await refreshActive(Number(job.id));}catch(e){await pool.execute("UPDATE sync_jobs SET estado='failed',mensaje_error=?,finished_at=UTC_TIMESTAMP() WHERE id=?",[safeError(e),job.id]);break;}
      }
      const [[counts]]=await pool.query<any[]>('SELECT COUNT(*) total, SUM(estado=\'failed\') errors FROM sync_job_days WHERE job_id=?',[job.id]);
      const state=Number(counts.errors)>0||job.active_refresh_status==='failed'?'completed_with_errors':'completed';
      await pool.execute('UPDATE sync_jobs SET estado=?,finished_at=UTC_TIMESTAMP() WHERE id=?',[state,job.id]);
    }
  }catch(e){console.error('[sync-worker] worker error:',safeError(e));}
  finally{if(gotLock)await conn.query("SELECT RELEASE_LOCK('oportuna_sync_worker')");conn.release();workerRunning=false;}
}
export async function recoverJobs() {
  if (!['all','sync-worker'].includes(loadRuntimeConfig().processRole)) return;
  const conn=await pool.getConnection();let locked=false;
  try{const [rows]=await conn.query<any[]>("SELECT GET_LOCK('oportuna_sync_worker',0) acquired");locked=Number(rows[0]?.acquired)===1;if(!locked)return;
    await pool.execute("UPDATE sync_job_days SET estado='pending',mensaje_error=COALESCE(mensaje_error,'Interrumpida por reinicio del servidor.') WHERE estado='in_progress'");
    await pool.execute("UPDATE sync_runs SET estado='fallida',mensaje_error=COALESCE(mensaje_error,'Interrumpida por reinicio del servidor.'),finished_at=UTC_TIMESTAMP() WHERE estado='en_progreso'");
    await pool.execute("UPDATE sync_jobs SET estado=CASE WHEN pause_requested=1 THEN 'paused' ELSE 'queued' END,pause_requested=0,mensaje_error=NULL WHERE estado='running'");
  }finally{if(locked)await conn.query("SELECT RELEASE_LOCK('oportuna_sync_worker')");conn.release();}
  void runWorker();
  if(process.env.SYNC_SCHEDULER_ENABLED==='true')void schedulerTick(new Date(),true);
}
export async function getHistory(page=1,pageSize=20){const size=Math.min(100,Math.max(1,pageSize));const [[count],[rows]]=await Promise.all([pool.query<any[]>('SELECT COUNT(*) total FROM sync_runs'),pool.query<any[]>("SELECT id,job_id jobId,source,DATE_FORMAT(fecha_consultada,'%Y-%m-%d') fecha,estado,total_recibidos totalRecibidos,total_insertados totalInsertados,total_actualizados totalActualizados,mensaje_error mensajeError,started_at startedAt,finished_at finishedAt FROM sync_runs ORDER BY started_at DESC LIMIT ? OFFSET ?",[size,(Math.max(1,page)-1)*size])]);return{items:rows,total:Number(count[0].total),page:Math.max(1,page),pageSize:size};}
async function schedulerTick(now=new Date(),startupRecovery=false){
  if(process.env.SYNC_SCHEDULER_ENABLED!=='true')return;
  const parts=santiagoParts(now);const today=santiagoDate(now);const minuteOfDay=Number(parts.hour)*60+Number(parts.minute);
  if(!startupRecovery&&!isDailySchedulerDue(now))return;
  const targetDate=startupRecovery&&minuteOfDay<480?addDays(today,-1):today;
  const connection=await pool.getConnection();let locked=false;
  try{
    const [locks]=await connection.query<any[]>("SELECT GET_LOCK('oportuna_sync_scheduler',0) acquired");locked=Number(locks[0]?.acquired)===1;if(!locked)return;
    const [[active],[failedToday],[latest],[activeRefresh]] = await Promise.all([
      pool.query<any[]>("SELECT id FROM sync_jobs WHERE estado IN ('queued','running','paused') LIMIT 1"),
      pool.query<any[]>("SELECT id FROM sync_jobs WHERE tipo='diaria' AND DATE(created_at)=? AND estado IN ('failed','completed_with_errors') LIMIT 1",[today]),
      pool.query<any[]>("SELECT DATE_FORMAT(MAX(fecha),'%Y-%m-%d') lastDate FROM sync_job_days WHERE estado='completed' AND fecha<=?",[targetDate]),
      pool.query<any[]>("SELECT DATE_FORMAT(MAX(fecha_consultada),'%Y-%m-%d') lastDate FROM sync_runs WHERE source='active_refresh' AND estado='completada' AND fecha_consultada=?",[today]),
    ]);
    if(active.length||failedToday.length)return;
    const lastDate=latest[0]?.lastDate?String(latest[0].lastDate):null;
    let plan=dailySyncPlan(now,lastDate,DAILY_CATCHUP_MAX_DAYS,targetDate);
    let includeDates=true;let refreshActive=Boolean(plan?.refreshActive)&&!(startupRecovery&&minuteOfDay<480);
    if(!plan&&targetDate===today&&lastDate&&lastDate>=today&&activeRefresh[0]?.lastDate!==today){plan={dateFrom:today,dateTo:today,totalPendingDays:0,refreshActive:true};includeDates=false;refreshActive=true;}
    if(!plan)return;
    const id=await startJob(plan.dateFrom,plan.dateTo,'diaria',false,refreshActive,includeDates);
    console.log(`[sync-scheduler] trabajo diario ${id} iniciado; rango=${includeDates?`${plan.dateFrom}–${plan.dateTo}`:'solo-refresco-activas'} recuperacion=${plan.totalPendingDays}`);
  }catch(e){console.warn('[sync-scheduler]',safeError(e));}
  finally{if(locked)await connection.query("SELECT RELEASE_LOCK('oportuna_sync_scheduler')");connection.release();}
}
export function runSchedulerTickForTest(now:Date,startupRecovery=false){return schedulerTick(now,startupRecovery);}
export function startSyncWorker(){const config=loadRuntimeConfig();if(!['all','sync-worker'].includes(config.processRole)||syncWorkerPoller)return;syncWorkerPoller=setInterval(()=>void runWorker(),5000);void runWorker();}
export function startScheduler(){const config=loadRuntimeConfig();if(!['all','sync-worker'].includes(config.processRole)||process.env.SYNC_SCHEDULER_ENABLED!=='true'||schedulerTimer)return;schedulerTimer=setInterval(()=>void schedulerTick().catch(e=>console.warn('[sync-scheduler]',safeError(e))),30000);void schedulerTick().catch(e=>console.warn('[sync-scheduler]',safeError(e)));}
