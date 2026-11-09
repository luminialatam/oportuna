import pool from './db.js';
import { resolveCurrentCompanyId } from './companyService.js';

const ZONE = 'America/Santiago';
type AlertType = 'closing_72h'|'closing_48h'|'closing_24h'|'closing_overdue'|'followup_upcoming'|'followup_today'|'followup_overdue';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const displayDate = new Intl.DateTimeFormat('es-CL', { timeZone: ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
function parts(date: Date) { return Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type,p.value])); }
function localMidnightUtc(dayOffset = 0, now = new Date()) {
  const p = parts(now); const localAsUtc = Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)+dayOffset);
  let guess = localAsUtc;
  for (let i=0;i<3;i++) { const q=parts(new Date(guess)); const represented=Date.UTC(Number(q.year),Number(q.month)-1,Number(q.day),Number(q.hour),Number(q.minute)); guess=localAsUtc-(represented-guess); }
  return new Date(guess);
}
const asDate = (value: unknown): Date|null => { const date=value instanceof Date?value:new Date(String(value??''));return Number.isNaN(date.getTime())?null:date; };
const sqlUtc = (date: Date) => date.toISOString().slice(0,19).replace('T',' ');

function closingAlert(closesAt: Date, now: Date) {
  const hours=(closesAt.getTime()-now.getTime())/3_600_000;
  if(hours<=0)return {type:'closing_overdue' as const,threshold:'overdue',title:'El cierre de la licitación venció'};
  if(hours<=24)return {type:'closing_24h' as const,threshold:'24h',title:'La licitación cierra dentro de 24 horas'};
  if(hours<=48)return {type:'closing_48h' as const,threshold:'48h',title:'La licitación cierra dentro de 48 horas'};
  if(hours<=72)return {type:'closing_72h' as const,threshold:'72h',title:'La licitación cierra dentro de 72 horas'};
  return null;
}

export async function evaluateAlerts(at = new Date()) {
  const companyId=await resolveCurrentCompanyId();
  return evaluateAlertsForCompany(companyId,at);
}

export async function evaluateAlertsForCompany(companyId:number,at = new Date()) {
  const now=at;const startTomorrow=localMidnightUtc(1,now);const activeKeys=new Set<string>();let created=0;
  const [opportunities]=await pool.query<any[]>(`SELECT t.id,t.codigo_externo,t.estado,l.nombre,l.fecha_cierre
    FROM company_opportunity_tracking t JOIN licitaciones l ON l.codigo_externo=t.codigo_externo
    WHERE t.company_id=? ORDER BY t.id`,[companyId]);
  const [dates]=await pool.query<any[]>(`SELECT d.id,d.tracking_id,d.label,d.due_at,d.completed,t.codigo_externo,l.nombre
    FROM company_opportunity_dates d JOIN company_opportunity_tracking t ON t.id=d.tracking_id AND t.company_id=d.company_id
    JOIN licitaciones l ON l.codigo_externo=t.codigo_externo WHERE d.company_id=?`,[companyId]);
  const add=async(input:{opportunityId:number;key:string;type:AlertType;title:string;message:string;due:Date})=>{
    activeKeys.add(input.key);
    const [result]=await pool.execute<any>(`INSERT IGNORE INTO company_alerts (company_id,opportunity_id,alert_type,alert_key,title,message,due_at)
      VALUES (?,?,?,?,?,?,?)`,[companyId,input.opportunityId,input.type,input.key,input.title,input.message,sqlUtc(input.due)]);
    created+=Number(result.affectedRows??0);
  };
  for(const opportunity of opportunities){
    const id=Number(opportunity.id);const code=String(opportunity.codigo_externo);const title=String(opportunity.nombre||code);const close=asDate(opportunity.fecha_cierre);
    if(opportunity.estado!=='discarded'&&opportunity.estado!=='submitted'&&close){
      const alert=closingAlert(close,now);
      if(alert){const due=close.toISOString();const key=`closing:${id}:${due}:${alert.threshold}`;await add({opportunityId:id,key,type:alert.type,title:alert.title,message:`${title} · ${code}. Fecha de cierre: ${displayDate.format(close)} (hora de Santiago).`,due:close});}
    }
  }
  const dateEventKeys=new Map<number,string>();
  for(const event of dates){
    if(Boolean(event.completed))continue;
    const opportunity=opportunities.find(row=>Number(row.id)===Number(event.tracking_id));if(!opportunity||['discarded','submitted'].includes(String(opportunity.estado)))continue;
    const due=asDate(event.due_at);if(!due)continue;
    let type:AlertType|null=null;let title='';
    if(due.getTime()<now.getTime()){type='followup_overdue';title='Una actividad de seguimiento está atrasada';}
    else if(due.getTime()<startTomorrow.getTime()){type='followup_today';title='Una actividad de seguimiento vence hoy';}
    else if(due.getTime()<=now.getTime()+72*3_600_000){type='followup_upcoming';title='Una actividad de seguimiento se acerca';}
    if(!type)continue;
    const dueIso=due.toISOString();const eventKey=`followup:${Number(event.id)}:${dueIso}`;dateEventKeys.set(Number(event.id),eventKey);
    const key=`${eventKey}:${type}`;await add({opportunityId:Number(event.tracking_id),key,type,title,message:`${event.label} · ${event.nombre||opportunity.nombre||event.codigo_externo} (${event.codigo_externo}). Vence: ${displayDate.format(due)} (hora de Santiago).`,due});
  }
  // Dismiss stale closure dates, completed/deleted dates, changed dates and superseded follow-up urgency.
  const [existing]=await pool.query<any[]>(`SELECT id,opportunity_id,alert_type,alert_key FROM company_alerts WHERE company_id=? AND dismissed_at IS NULL`,[companyId]);
  const currentClosure=new Map(opportunities.map(row=>[Number(row.id),asDate(row.fecha_cierre)?.toISOString()??null]));
  const currentDateKeys=new Map(dates.map(row=>[Number(row.id),`followup:${Number(row.id)}:${asDate(row.due_at)?.toISOString()??''}`]));
  for(const alert of existing){
    const type=String(alert.alert_type) as AlertType;const key=String(alert.alert_key);const opportunityId=Number(alert.opportunity_id);let stale=false;
    if(type.startsWith('closing_')){const expected=currentClosure.get(opportunityId);stale=!expected||!key.startsWith(`closing:${opportunityId}:${expected}:`)||!activeKeys.has(key)||['discarded','submitted'].includes(String(opportunities.find(row=>Number(row.id)===opportunityId)?.estado));}
    else {const match=/^followup:(\d+):/.exec(key);const dateId=match?Number(match[1]):0;const expected=currentDateKeys.get(dateId);stale=!expected||!key.startsWith(`${expected}:`)||!dateEventKeys.has(dateId);}
    if(stale)await pool.execute('UPDATE company_alerts SET dismissed_at=UTC_TIMESTAMP() WHERE id=? AND company_id=? AND dismissed_at IS NULL',[alert.id,companyId]);
  }
  // Keep only the latest urgency notification active for each follow-up event.
  for(const alert of existing){if(!String(alert.alert_type).startsWith('followup_'))continue;const match=/^(followup:\d+:[^:]+):/.exec(String(alert.alert_key));if(match&&dateEventKeys.has(Number(match[1].split(':')[1]))&&!activeKeys.has(String(alert.alert_key)))await pool.execute('UPDATE company_alerts SET dismissed_at=UTC_TIMESTAMP() WHERE id=? AND company_id=? AND dismissed_at IS NULL',[alert.id,companyId]);}
  return {created,evaluatedAt:now.toISOString(),timezone:ZONE};
}

export async function listAlerts(options:{filter?:'all'|'unread'|'closing'|'followup';limit?:number}){
  const companyId=await resolveCurrentCompanyId();const where=['a.company_id=?','a.dismissed_at IS NULL'];const values:any[]=[companyId];
  if(options.filter==='unread')where.push('a.read_at IS NULL');if(options.filter==='closing')where.push("a.alert_type LIKE 'closing_%'");if(options.filter==='followup')where.push("a.alert_type LIKE 'followup_%'");
  const limit=Math.max(1,Math.min(200,options.limit??100));
  const [rows]=await pool.query<any[]>(`SELECT a.id,a.opportunity_id,a.alert_type,a.alert_key,a.title,a.message,a.due_at,a.read_at,a.dismissed_at,a.created_at,t.codigo_externo,t.estado,l.nombre
    FROM company_alerts a JOIN company_opportunity_tracking t ON t.id=a.opportunity_id AND t.company_id=a.company_id JOIN licitaciones l ON l.codigo_externo=t.codigo_externo
    WHERE ${where.join(' AND ')} ORDER BY a.read_at IS NULL DESC,a.due_at ASC,a.created_at DESC LIMIT ?`,[...values,limit]);
  return rows.map(row=>({id:Number(row.id),opportunityId:Number(row.opportunity_id),type:row.alert_type,key:row.alert_key,title:row.title,message:row.message,dueAt:row.due_at,readAt:row.read_at,createdAt:row.created_at,code:row.codigo_externo,opportunityStatus:row.estado,listingName:row.nombre}));
}
export async function alertCounts(){const companyId=await resolveCurrentCompanyId();const [[row]]=await pool.query<any[]>('SELECT COUNT(*) total,SUM(read_at IS NULL) unread FROM company_alerts WHERE company_id=? AND dismissed_at IS NULL',[companyId]);return {total:Number(row.total??0),unread:Number(row.unread??0)};}
export async function markAlertRead(id:number){const companyId=await resolveCurrentCompanyId();const [result]=await pool.execute<any>('UPDATE company_alerts SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=? AND company_id=? AND dismissed_at IS NULL',[id,companyId]);return result.affectedRows>0;}
export async function dismissAlert(id:number){const companyId=await resolveCurrentCompanyId();const [result]=await pool.execute<any>('UPDATE company_alerts SET dismissed_at=UTC_TIMESTAMP() WHERE id=? AND company_id=? AND dismissed_at IS NULL',[id,companyId]);return result.affectedRows>0;}
