import { randomUUID } from 'node:crypto';
import pool from './db.js';
import { appBaseUrl, logSmtpFailure, sendEmail } from './emailService.js';

export type OpportunityEmailItem = { code: string; name: string; level: 'high'|'medium'|'exploratory'; score: number|null; reasons: string[] };

export async function getAlertEmailPreference(companyId:number,userId:number){
  const [[users],[preferences]]=await Promise.all([
    pool.query<any[]>('SELECT email_normalized email,email_verified_at verifiedAt FROM app_users WHERE id=? AND status=\'active\' LIMIT 1',[userId]),
    pool.query<any[]>('SELECT enabled FROM company_alert_email_preferences WHERE company_id=? AND user_id=? LIMIT 1',[companyId,userId]),
  ]);
  return {enabled:Boolean(preferences[0]?.enabled),email:String(users[0]?.email??''),verified:Boolean(users[0]?.verifiedAt)};
}

export async function saveAlertEmailPreference(companyId:number,userId:number,enabled:boolean){
  if(enabled){
    const [[users],[memberships]]=await Promise.all([
      pool.query<any[]>('SELECT email_verified_at verifiedAt FROM app_users WHERE id=? AND status=\'active\' LIMIT 1',[userId]),
      pool.query<any[]>('SELECT status FROM company_memberships WHERE company_id=? AND user_id=? LIMIT 1',[companyId,userId]),
    ]);
    if(!memberships[0]||memberships[0].status!=='active')throw new Error('La membresía de esta empresa no está activa.');
    if(!users[0]?.verifiedAt)throw new Error('Verifica tu correo antes de activar los avisos por email.');
  }
  await pool.execute(`INSERT INTO company_alert_email_preferences(company_id,user_id,enabled) VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`,[companyId,userId,enabled?1:0]);
  if(!enabled)await pool.execute(`UPDATE company_alert_email_outbox SET status='failed',last_error_code='OPTED_OUT'
    WHERE company_id=? AND user_id=? AND status='queued'`,[companyId,userId]);
  return getAlertEmailPreference(companyId,userId);
}

/** Queue one idempotent digest for every verified member who opted in. */
export async function queueNewOpportunityEmails(companyId:number,listings:OpportunityEmailItem[]){
  if(!listings.length)return 0;
  const batchKey=randomUUID();
  const [inserted]=await pool.execute<any>(`INSERT IGNORE INTO company_alert_email_outbox(company_id,user_id,batch_key,listings)
    SELECT p.company_id,p.user_id,?,? FROM company_alert_email_preferences p
    JOIN company_memberships m ON m.company_id=p.company_id AND m.user_id=p.user_id AND m.status='active'
    JOIN app_users u ON u.id=p.user_id AND u.status='active' AND u.email_verified_at IS NOT NULL
    WHERE p.company_id=? AND p.enabled=1`,[batchKey,JSON.stringify(listings.slice(0,50)),companyId]);
  return Number(inserted.affectedRows??0);
}

/** Deliver a bounded number of queued digests; recover abandoned SMTP claims. */
export async function deliverOpportunityEmailDigests(limit=10,companyId?:number){
  const [rows]=await pool.query<any[]>(`SELECT o.id,o.company_id companyId,o.user_id userId,o.listings,u.email_normalized email,
      c.nombre_comercial companyName,o.attempts
    FROM company_alert_email_outbox o
    JOIN company_alert_email_preferences p ON p.company_id=o.company_id AND p.user_id=o.user_id AND p.enabled=1
    JOIN company_memberships m ON m.company_id=o.company_id AND m.user_id=o.user_id AND m.status='active'
    JOIN app_users u ON u.id=o.user_id AND u.status='active' AND u.email_verified_at IS NOT NULL
    JOIN companies c ON c.id=o.company_id
    WHERE ((o.status='queued' AND o.next_attempt_at<=UTC_TIMESTAMP())
       OR (o.status='sending' AND o.updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE)
           AND m.status='active' AND u.status='active' AND u.email_verified_at IS NOT NULL))
      ${companyId===undefined?'':'AND o.company_id=?'}
    ORDER BY o.id LIMIT ?`,companyId===undefined?[Math.max(1,Math.min(25,limit))]:[companyId,Math.max(1,Math.min(25,limit))]);
  let sent=0,failed=0;
  for(const row of rows){
    const [claimed]=await pool.execute<any>(`UPDATE company_alert_email_outbox SET status='sending',attempts=attempts+1
      WHERE id=? AND ((status='queued' AND next_attempt_at<=UTC_TIMESTAMP()) OR (status='sending' AND updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE)))`,[row.id]);
    if(!claimed.affectedRows)continue;
    try{
      const parsed=typeof row.listings==='string'?JSON.parse(row.listings):row.listings;
      const listings=(Array.isArray(parsed)?parsed:[]) as OpportunityEmailItem[];
      const entries=listings.slice(0,20).map(item=>`• ${item.name} (${item.code}) — ${item.level==='high'?'coincidencia alta':item.level==='medium'?'coincidencia media':'señal exploratoria'}${item.reasons?.length?`\n  ${item.reasons.slice(0,2).join('; ')}`:''}\n  ${appBaseUrl()}/oportunidades/${encodeURIComponent(item.code)}`).join('\n\n');
      const first=listings[0];
      await sendEmail({to:String(row.email),purpose:'new-opportunities',subject:`${listings.length} nueva${listings.length===1?'':'s'} oportunidad${listings.length===1?'':'es'} para ${row.companyName}`,
        text:`Hola,\n\nOportuna encontró ${listings.length} licitación${listings.length===1?'':'es'} nueva${listings.length===1?'':'s'} para ${row.companyName}, según el perfil comercial activo.\n\n${entries}${listings.length>20?`\n\nHay ${listings.length-20} coincidencias adicionales en Alertas.`:''}\n\nLas coincidencias son evidencia textual; no representan probabilidad de adjudicación. Revisa siempre la ficha y las bases oficiales.\n\n${first?`Abrir primera ficha: ${appBaseUrl()}/oportunidades/${encodeURIComponent(first.code)}`:appBaseUrl()}\n\nAdministrar avisos: ${appBaseUrl()}/alertas` ,
        link:first?`${appBaseUrl()}/oportunidades/${encodeURIComponent(first.code)}`:appBaseUrl()});
      await pool.execute(`UPDATE company_alert_email_outbox SET status='sent',sent_at=UTC_TIMESTAMP(),last_error_code=NULL WHERE id=?`,[row.id]);sent++;
    }catch(error){
      logSmtpFailure('new-opportunities',error);failed++;
      await pool.execute(`UPDATE company_alert_email_outbox SET status=IF(attempts>=5,'failed','queued'),
        next_attempt_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),last_error_code=? WHERE id=?`,['DELIVERY_FAILED',row.id]);
    }
  }
  return {sent,failed};
}
