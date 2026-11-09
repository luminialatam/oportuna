import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pool from './db.js';

const SESSION_TTL_DAYS = 14;
const RESET_TTL_MINUTES = 30;
const hashToken = (token: string) => createHash('sha256').update(token).digest();
const opaqueToken = () => randomBytes(32).toString('base64url');
export const normalizeEmail = (email: string) => email.trim().normalize('NFKC').toLowerCase();
export function validEmail(email: string) { return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
export async function hashPassword(password: string) {
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('La contraseña debe tener al menos 12 caracteres.');
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

type Membership = { companyId: number; companyName: string; role: 'admin'|'collaborator'|'read_only' };
export type AuthenticatedSession = { id: string; userId: number; email: string; firstName: string; lastName: string; platformRole: 'user'|'admin'; emailVerified:boolean; activeCompanyId: number|null; role: Membership['role']|null; csrfToken: string; memberships: Membership[] };

export async function createSession(userId: number, activeCompanyId?: number|null) {
  const [[users],[memberships]] = await Promise.all([
    pool.query<any[]>('SELECT id,email_normalized,first_name,last_name,platform_role,status,email_verified_at FROM app_users WHERE id=? LIMIT 1',[userId]),
    pool.query<any[]>(`SELECT m.company_id,m.role,c.nombre_comercial FROM company_memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=? AND m.status='active' ORDER BY c.nombre_comercial,m.company_id`,[userId]),
  ]);
  const user=users[0]; if(!user||user.status!=='active')throw new Error('No se pudo iniciar sesión.');
  const available=memberships.find((m:any)=>Number(m.company_id)===Number(activeCompanyId))??(activeCompanyId==null?memberships[0]:null);
  if(activeCompanyId!=null&&!available)throw new Error('La cuenta no pertenece a esa empresa.');
  const raw=opaqueToken();const csrf=opaqueToken();const id=randomUUID();
  const expires=new Date(Date.now()+SESSION_TTL_DAYS*86400000);
  await pool.execute('INSERT INTO app_sessions (id,user_id,active_company_id,token_hash,csrf_hash,expires_at) VALUES (UUID_TO_BIN(?),?,?,?,?,?)',[id,userId,available?Number(available.company_id):null,hashToken(raw),hashToken(csrf),expires]);
  const mapped=memberships.map((m:any)=>({companyId:Number(m.company_id),companyName:String(m.nombre_comercial||'Empresa'),role:m.role as Membership['role']}));
  return {raw,csrf,expires,session:{id,userId:Number(user.id),email:String(user.email_normalized),firstName:String(user.first_name??''),lastName:String(user.last_name??''),platformRole:user.platform_role,emailVerified:Boolean(user.email_verified_at),activeCompanyId:available?Number(available.company_id):null,role:available?.role??null,csrfToken:csrf,memberships:mapped} satisfies AuthenticatedSession};
}

export async function getSession(raw: string, csrf?: string): Promise<AuthenticatedSession|null> {
  if(!raw||raw.length>128)return null;
  const [rows]=await pool.query<any[]>(`SELECT BIN_TO_UUID(s.id) id,s.user_id,s.active_company_id,s.csrf_hash,s.expires_at,u.email_normalized,u.first_name,u.last_name,u.platform_role,u.status,u.email_verified_at
    FROM app_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP() LIMIT 1`,[hashToken(raw)]);
  const row=rows[0];if(!row||row.status!=='active')return null;
  if(!csrf||csrf.length>128||!hashToken(csrf).equals(row.csrf_hash))return null;
  const [membershipRows]=await pool.query<any[]>(`SELECT m.company_id,m.role,c.nombre_comercial FROM company_memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=? AND m.status='active' ORDER BY c.nombre_comercial,m.company_id`,[row.user_id]);
  const memberships=membershipRows.map((m:any)=>({companyId:Number(m.company_id),companyName:String(m.nombre_comercial||'Empresa'),role:m.role as Membership['role']}));
  const active=memberships.find((m:Membership)=>m.companyId===Number(row.active_company_id));
  return {id:String(row.id),userId:Number(row.user_id),email:String(row.email_normalized),firstName:String(row.first_name??''),lastName:String(row.last_name??''),platformRole:row.platform_role,emailVerified:Boolean(row.email_verified_at),activeCompanyId:active?.companyId??null,role:active?.role??null,csrfToken:csrf,memberships};
}

export async function revokeSession(raw: string) { if(raw)await pool.execute('UPDATE app_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()) WHERE token_hash=? AND revoked_at IS NULL',[hashToken(raw)]); }
export async function setActiveCompany(sessionId:string,userId:number,companyId:number) {
  const [result]=await pool.execute<any>(`UPDATE app_sessions s JOIN company_memberships m ON m.user_id=s.user_id AND m.company_id=? AND m.status='active'
    SET s.active_company_id=m.company_id WHERE s.id=UUID_TO_BIN(?) AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP()`,[companyId,sessionId,userId]);
  return result.affectedRows>0;
}
export async function rotateCsrf(sessionId:string,userId:number) {
  const token=opaqueToken();await pool.execute('UPDATE app_sessions SET csrf_hash=? WHERE id=UUID_TO_BIN(?) AND user_id=? AND revoked_at IS NULL',[hashToken(token),sessionId,userId]);return token;
}

export async function login(emailInput:string,password:string) {
  const email=normalizeEmail(emailInput);if(!validEmail(email))return null;
  const [users]=await pool.query<any[]>('SELECT id,password_hash,status FROM app_users WHERE email_normalized=? LIMIT 1',[email]);
  const user=users[0];let valid=false;
  if(user?.status==='active'){try{valid=await argon2.verify(user.password_hash,password);}catch{valid=false;}}
  if(!valid)return null;
  return Number(user.id);
}

export async function createUser(emailInput:string,password:string,platformRole:'user'|'admin'='user',firstName='',lastName='') {
  const email=normalizeEmail(emailInput);if(!validEmail(email))throw new Error('Correo inválido.');const passwordHash=await hashPassword(password);
  const [result]=await pool.execute<any>("INSERT INTO app_users (email_normalized,first_name,last_name,password_hash,platform_role,status,email_verified_at) VALUES (?,?,?,?,?,'active',UTC_TIMESTAMP())",[email,firstName.trim().slice(0,100),lastName.trim().slice(0,100),passwordHash,platformRole]);return Number(result.insertId);
}

const verificationDigest = (token:string) => hashToken(token);
export async function registerPendingUser(emailInput:string,password:string,firstName:string,lastName:string,invitationToken?:string) {
  const email=normalizeEmail(emailInput);if(!validEmail(email))throw new Error('Correo inválido.');const passwordHash=await hashPassword(password);const token=opaqueToken();const conn=await pool.getConnection();
  try { await conn.beginTransaction();let invitationId:number|null=null;
    if(invitationToken){const [rows]=await conn.query<any[]>(`SELECT id,invited_email FROM company_invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[hashToken(invitationToken)]);const invite=rows[0];if(!invite||normalizeEmail(invite.invited_email)!==email)throw new Error('La invitación no es válida o venció.');invitationId=Number(invite.id);}
    const [created]=await conn.execute<any>("INSERT INTO app_users (email_normalized,first_name,last_name,password_hash,platform_role,status,email_verified_at) VALUES (?,?,?,?,'user','active',NULL)",[email,firstName.trim().slice(0,100),lastName.trim().slice(0,100),passwordHash]);
    await conn.execute('INSERT INTO email_verification_tokens (user_id,invitation_id,token_hash,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))',[created.insertId,invitationId,verificationDigest(token)]);await conn.commit();return {userId:Number(created.insertId),email,token};
  } catch(error) { await conn.rollback();throw error; } finally { conn.release(); }
}

export async function issueEmailVerification(userId:number) {
  const token=opaqueToken();const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.query<any[]>("SELECT email_normalized,email_verified_at FROM app_users WHERE id=? AND status='active' LIMIT 1 FOR UPDATE",[userId]);const user=rows[0];if(!user||user.email_verified_at){await conn.rollback();return null;}await conn.execute('UPDATE email_verification_tokens SET used_at=COALESCE(used_at,UTC_TIMESTAMP()) WHERE user_id=? AND used_at IS NULL',[userId]);await conn.execute('INSERT INTO email_verification_tokens (user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE))',[userId,verificationDigest(token)]);await conn.commit();return {email:String(user.email_normalized),token};}
  catch(error){await conn.rollback();throw error;}finally{conn.release();}
}

export async function completeEmailVerification(token:string) {
  if(!token||token.length>128)return false;const conn=await pool.getConnection();
  try { await conn.beginTransaction();const [rows]=await conn.query<any[]>(`SELECT t.user_id,t.invitation_id,u.email_normalized FROM email_verification_tokens t JOIN app_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>UTC_TIMESTAMP() AND u.status='active' FOR UPDATE`,[verificationDigest(token)]);const row=rows[0];if(!row){await conn.rollback();return false;}
    await conn.execute('UPDATE app_users SET email_verified_at=UTC_TIMESTAMP() WHERE id=? AND email_verified_at IS NULL',[row.user_id]);await conn.execute('UPDATE email_verification_tokens SET used_at=UTC_TIMESTAMP() WHERE token_hash=?',[verificationDigest(token)]);
    if(row.invitation_id){const [invites]=await conn.query<any[]>(`SELECT id,company_id,role,invited_email FROM company_invitations WHERE id=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[row.invitation_id]);const invite=invites[0];if(!invite||normalizeEmail(invite.invited_email)!==normalizeEmail(row.email_normalized))throw new Error('La invitación ya no está disponible.');
      await conn.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,?,'active') ON DUPLICATE KEY UPDATE role=VALUES(role),status='active'",[row.user_id,invite.company_id,invite.role]);await conn.execute('UPDATE company_invitations SET accepted_at=UTC_TIMESTAMP() WHERE id=?',[invite.id]);await conn.execute('UPDATE app_sessions SET active_company_id=? WHERE user_id=? AND revoked_at IS NULL AND active_company_id IS NULL',[invite.company_id,row.user_id]);
    }
    await conn.commit();return true;
  } catch(error) { await conn.rollback();throw error; } finally { conn.release(); }
}

export async function createInvitation(companyId:number,emailInput:string,role:'admin'|'collaborator'|'read_only',createdBy:number) {
  const email=normalizeEmail(emailInput);if(!validEmail(email))throw new Error('Correo inválido.');
  const token=opaqueToken();const expires=new Date(Date.now()+7*86400000);
  await pool.execute('INSERT INTO company_invitations (company_id,invited_email,role,token_hash,created_by,expires_at) VALUES (?,?,?,?,?,?)',[companyId,email,role,hashToken(token),createdBy,expires]);
  return {token,expiresAt:expires.toISOString()};
}

export async function acceptInvitation(token:string,emailInput:string,password:string,firstName='',lastName='') {
  const email=normalizeEmail(emailInput);if(!validEmail(email)||token.length>128)throw new Error('La invitación no es válida o venció.');const passwordHash=await hashPassword(password);const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.query<any[]>(`SELECT id,company_id,role,invited_email FROM company_invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[hashToken(token)]);const invite=rows[0];if(!invite||invite.invited_email!==email)throw new Error('La invitación no es válida o venció.');
    const [existing]=await conn.query<any[]>('SELECT id FROM app_users WHERE email_normalized=? FOR UPDATE',[email]);if(existing[0])throw new Error('Esta cuenta ya existe. Inicia sesión para aceptar la invitación.');
    const [created]=await conn.execute<any>("INSERT INTO app_users (email_normalized,first_name,last_name,password_hash,status,email_verified_at) VALUES (?,?,?,?,'active',UTC_TIMESTAMP())",[email,firstName.trim().slice(0,100),lastName.trim().slice(0,100),passwordHash]);const userId=Number(created.insertId);
    await conn.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,?,'active') ON DUPLICATE KEY UPDATE role=VALUES(role),status='active'",[userId,Number(invite.company_id),invite.role]);await conn.execute('UPDATE company_invitations SET accepted_at=UTC_TIMESTAMP() WHERE id=?',[invite.id]);await conn.commit();return userId;
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}

export async function acceptInvitationForUser(token:string,userId:number,emailInput:string) {
  const email=normalizeEmail(emailInput);if(!validEmail(email)||token.length>128)throw new Error('La invitación no es válida o venció.');const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.query<any[]>(`SELECT id,company_id,role,invited_email FROM company_invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[hashToken(token)]);const invite=rows[0];if(!invite||invite.invited_email!==email)throw new Error('La invitación no es válida o venció.');await conn.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,?,'active') ON DUPLICATE KEY UPDATE role=VALUES(role),status='active'",[userId,Number(invite.company_id),invite.role]);await conn.execute('UPDATE company_invitations SET accepted_at=UTC_TIMESTAMP() WHERE id=?',[invite.id]);await conn.commit();return Number(invite.company_id);}catch(error){await conn.rollback();throw error;}finally{conn.release();}
}

export async function createPasswordReset(emailInput:string) {
  const email=normalizeEmail(emailInput);if(!validEmail(email))return null;const [rows]=await pool.query<any[]>('SELECT id FROM app_users WHERE email_normalized=? AND status=\'active\' LIMIT 1',[email]);if(!rows[0])return null;
  const token=opaqueToken();const expires=new Date(Date.now()+RESET_TTL_MINUTES*60_000);await pool.execute('INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)',[hashToken(token),rows[0].id,expires]);return {token,userId:Number(rows[0].id),expiresAt:expires};
}
export async function consumePasswordReset(token:string,password:string) {
  if(!token||token.length>128)return false;const passwordHash=await hashPassword(password);const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.query<any[]>(`SELECT user_id FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[hashToken(token)]);if(!rows[0]){await conn.rollback();return false;}const userId=Number(rows[0].user_id);await conn.execute('UPDATE app_users SET password_hash=? WHERE id=?',[passwordHash,userId]);await conn.execute('UPDATE password_reset_tokens SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND used_at IS NULL',[userId]);await conn.execute('UPDATE app_sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[userId]);await conn.commit();return true;}catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
