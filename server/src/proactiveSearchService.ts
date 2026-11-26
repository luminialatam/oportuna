import pool from './db.js';
import { getCompanyMatches } from './companyService.js';
import { resolveCurrentCompanyId } from './companyService.js';
import { runWithCompanyContext } from './companyRequestContext.js';
import { loadRuntimeConfig } from './runtimeConfig.js';

type Frequency='hourly'|'daily'|'weekly';
const sqlUtc=(value:Date)=>value.toISOString().slice(0,19).replace('T',' ');
const asDate=(value:unknown):Date|null=>{const date=value instanceof Date?value:new Date(String(value??''));return Number.isNaN(date.getTime())?null:date;};
const jsonList=(value:unknown):string[]=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)?parsed.map(String):[];}catch{return[];}};

function schedulerStatus(){
  const config=loadRuntimeConfig();
  return {processScheduler:['all','alert-worker'].includes(config.processRole)&&config.alertSchedulerEnabled,externalEndpoint:Boolean(process.env.SYNC_API_TOKEN?.trim()),frequencyFloorMinutes:5};
}

export async function getProactiveSearchPreferences(){
  const companyId=await resolveCurrentCompanyId();
  const [[rows],[products],[profiles]]=await Promise.all([
    pool.query<any[]>('SELECT enabled,frequency,last_checked_at lastCheckedAt,last_error_code lastErrorCode FROM company_proactive_search_preferences WHERE company_id=?',[companyId]),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=? AND activo=1',[companyId]),
    pool.query<any[]>('SELECT palabras_clave keywords FROM commercial_profiles WHERE company_id=?',[companyId]),
  ]);
  const productCount=Number(products[0]?.total??0);
  const keywordCount=jsonList(profiles[0]?.keywords).length;
  return {enabled:Boolean(rows[0]?.enabled),frequency:(rows[0]?.frequency??'daily') as Frequency,lastCheckedAt:rows[0]?.lastCheckedAt??null,lastErrorCode:rows[0]?.lastErrorCode??null,configuredProfiles:productCount+keywordCount,scheduler:schedulerStatus()};
}

export async function saveProactiveSearchPreferences(input:{enabled:boolean;frequency:Frequency}){
  const companyId=await resolveCurrentCompanyId();
  await pool.execute(`INSERT INTO company_proactive_search_preferences(company_id,enabled,frequency,last_checked_at,last_error_code)
    VALUES(?,?,?,?,NULL) ON DUPLICATE KEY UPDATE
    last_checked_at=IF(enabled=0 AND VALUES(enabled)=1,UTC_TIMESTAMP(),last_checked_at),
    enabled=VALUES(enabled),frequency=VALUES(frequency),last_error_code=NULL`,[companyId,input.enabled?1:0,input.frequency,input.enabled?sqlUtc(new Date()):null]);
  return getProactiveSearchPreferences();
}

async function evaluateCompany(companyId:number,cutoff:Date|null){
  const result=await runWithCompanyContext({userId:0,companyId,role:'admin',platformRole:'user'},()=>getCompanyMatches({includeAllItems:true,evaluationLimit:800}));
  let created=0;
  for(const item of result.items??[]){
    const code=String(item.codigo_externo??'').trim();if(!code)continue;
    const published=asDate(item.fecha_publicacion);
    if(cutoff&&(!published||published.getTime()<Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth(),cutoff.getUTCDate())))continue;
    const level=item.level==='high'||item.level==='medium'?item.level:'exploratory';
    const reasons=Array.isArray(item.matchReasons)?item.matchReasons.map(String).slice(0,8):[];
    const [inserted]=await pool.execute<any>(`INSERT IGNORE INTO company_proactive_matches
      (company_id,listing_code,listing_name,match_level,match_score,match_reasons)
      SELECT ?,?,nombre,?,?,? FROM licitaciones WHERE codigo_externo=?`,
      [companyId,code,level,Number.isFinite(Number(item.score))?Math.max(0,Math.min(100,Math.round(Number(item.score)))):null,JSON.stringify(reasons),code]);
    created+=Number(inserted.affectedRows??0);
  }
  return {evaluated:Number(result.candidatesEvaluated??0),created};
}

/** Runs the active company's local index search on demand, sharing the worker lock. */
export async function runCurrentCompanyProactiveSearch(){
  const companyId=await resolveCurrentCompanyId();
  const preferences=await getProactiveSearchPreferences();
  if(!preferences.configuredProfiles)return {evaluated:0,created:0,configured:false,locked:false,completedAt:new Date().toISOString()};
  const connection=await pool.getConnection();let locked=false;
  try{
    const [lockRows]=await connection.query<any[]>("SELECT GET_LOCK('oportuna_proactive_search',0) acquired");
    locked=Number(lockRows[0]?.acquired)===1;
    if(!locked)return {evaluated:0,created:0,configured:true,locked:true,completedAt:null};
    const result=await evaluateCompany(companyId,null);
    const completedAt=new Date();
    await pool.execute(`INSERT INTO company_proactive_search_preferences(company_id,enabled,frequency,last_checked_at,last_error_code)
      VALUES(?,0,'daily',?,NULL) ON DUPLICATE KEY UPDATE last_checked_at=VALUES(last_checked_at),last_error_code=NULL`,[companyId,sqlUtc(completedAt)]);
    return {...result,configured:true,locked:false,completedAt:completedAt.toISOString()};
  }finally{
    if(locked)await connection.query("SELECT RELEASE_LOCK('oportuna_proactive_search')");
    connection.release();
  }
}

/** One MySQL advisory lock prevents overlapping process and cron runs. */
export async function runProactiveSearchPass(now=new Date()){
  const connection=await pool.getConnection();let locked=false;
  const summary={companies:0,evaluated:0,created:0,failed:0,locked:false};
  try{
    const [lockRows]=await connection.query<any[]>("SELECT GET_LOCK('oportuna_proactive_search',0) acquired");
    locked=Number(lockRows[0]?.acquired)===1;if(!locked){summary.locked=true;return summary;}
    const [companies]=await pool.query<any[]>(`SELECT company_id companyId,frequency,last_checked_at lastCheckedAt FROM company_proactive_search_preferences
      WHERE enabled=1 AND (last_checked_at IS NULL
        OR (frequency='hourly' AND last_checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR))
        OR (frequency='daily' AND last_checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY))
        OR (frequency='weekly' AND last_checked_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY))) ORDER BY last_checked_at,company_id LIMIT 100`);
    for(const row of companies){
      const companyId=Number(row.companyId);const cutoff=asDate(row.lastCheckedAt);
      const [claimed]=await pool.execute<any>('UPDATE company_proactive_search_preferences SET last_checked_at=?,last_error_code=NULL WHERE company_id=? AND enabled=1 AND (last_checked_at IS NULL OR last_checked_at=?)',[sqlUtc(now),companyId,row.lastCheckedAt??null]);
      if(!claimed.affectedRows)continue;
      summary.companies++;
      try{const result=await evaluateCompany(companyId,cutoff);summary.evaluated+=result.evaluated;summary.created+=result.created;}
      catch{summary.failed++;await pool.execute("UPDATE company_proactive_search_preferences SET last_checked_at=?,last_error_code='SEARCH_FAILED' WHERE company_id=?",[row.lastCheckedAt??null,companyId]);}
    }
    return summary;
  }finally{if(locked)await connection.query("SELECT RELEASE_LOCK('oportuna_proactive_search')");connection.release();}
}

export async function listProactiveMatches(options:{filter?:'all'|'unread'|'matches'|'pending';limit:number}){
  const companyId=await resolveCurrentCompanyId();const clauses=['company_id=?','dismissed_at IS NULL'];
  if(options.filter==='unread'||options.filter==='pending')clauses.push('read_at IS NULL');
  const [rows]=await pool.query<any[]>(`SELECT id,listing_code code,listing_name listingName,match_level matchLevel,match_score matchScore,match_reasons matchReasons,read_at readAt,created_at createdAt FROM company_proactive_matches WHERE ${clauses.join(' AND ')} ORDER BY read_at IS NULL DESC,created_at DESC LIMIT ?`,[companyId,Math.max(1,Math.min(200,options.limit))]);
  return rows.map(row=>({id:-Number(row.id),opportunityId:0,type:'new_match',title:`Nueva coincidencia: ${row.listingName??row.code}`,message:jsonList(row.matchReasons).join(' '),dueAt:row.createdAt,readAt:row.readAt,createdAt:row.createdAt,code:row.code,listingName:row.listingName,matchLevel:row.matchLevel,matchScore:row.matchScore==null?null:Number(row.matchScore)}));
}

export async function proactiveMatchCounts(){
  const companyId=await resolveCurrentCompanyId();const [[row]]=await pool.query<any[]>('SELECT COUNT(*) total,SUM(read_at IS NULL) unread FROM company_proactive_matches WHERE company_id=? AND dismissed_at IS NULL',[companyId]);
  return {total:Number(row?.total??0),unread:Number(row?.unread??0)};
}
export async function setProactiveMatchRead(id:number){const companyId=await resolveCurrentCompanyId();const [result]=await pool.execute<any>('UPDATE company_proactive_matches SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=? AND company_id=? AND dismissed_at IS NULL',[id,companyId]);return Number(result.affectedRows)>0;}
export async function dismissProactiveMatch(id:number){const companyId=await resolveCurrentCompanyId();const [result]=await pool.execute<any>('UPDATE company_proactive_matches SET dismissed_at=UTC_TIMESTAMP() WHERE id=? AND company_id=? AND dismissed_at IS NULL',[id,companyId]);return Number(result.affectedRows)>0;}
