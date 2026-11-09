import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pool from '../src/db.js';
import { createUser } from '../src/authService.js';

const root=resolve(import.meta.dirname,'../..');
const host=process.env.DB_HOST||'127.0.0.1';
assert.ok(['127.0.0.1','localhost','::1'].includes(host),'This test only allows local MySQL.');
const [[before]]=await pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) uniqueCodes FROM licitaciones');
const suffix=randomUUID();
const adminEmail=`qa-smtp-failure-admin-${suffix}@invalid.example`;
const pendingEmail=`qa-smtp-failure-pending-${suffix}@invalid.example`;
const invitedEmail=`qa-smtp-failure-invited-${suffix}@invalid.example`;
const password='QA-Only-Temporary-Password-2026!';
let companyId=0,adminId=0,pendingId=0,port=0;
let child:ReturnType<typeof spawn>|undefined;
let childOutput='';
const tempSocket=createServer();
tempSocket.listen(0,'127.0.0.1');
await once(tempSocket,'listening');
port=(tempSocket.address() as any).port;
await new Promise<void>((resolveClose,reject)=>tempSocket.close(error=>error?reject(error):resolveClose()));

try{
  const [company]=await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[`TEMP SMTP FAILURE ${suffix}`]);companyId=Number(company.insertId);
  adminId=await createUser(adminEmail,password,'user','QA','SMTP');
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')",[adminId,companyId]);
  child=spawn(process.execPath,[
    '--require',resolve(root,'node_modules/tsx/dist/preflight.cjs'),
    '--import',pathToFileURL(resolve(root,'node_modules/tsx/dist/loader.mjs')).href,
    resolve(root,'server/src/index.ts'),
  ],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',CLIENT_ORIGIN:`http://127.0.0.1:${port}`,APP_ENV:'development',PROCESS_ROLE:'web',SYNC_SCHEDULER_ENABLED:'false',ENRICHMENT_WORKER_ENABLED:'false',ALERT_SCHEDULER_ENABLED:'false',EMAIL_TRANSPORT:'smtp',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(port),SMTP_SECURE:'true',SMTP_USERNAME:'qa-only',SMTP_PASSWORD:'QA-SECRET-MUST-NOT-APPEAR',SMTP_FROM:'no-reply@example.invalid',SMTP_TIMEOUT_MS:'2000'},stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',chunk=>{childOutput+=String(chunk);});
  child.stderr?.on('data',chunk=>{childOutput+=String(chunk);});
  const origin=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw new Error('SMTP failure test server exited during startup.');
    try{const response=await fetch(`${origin}/api/health`);if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolveWait=>setTimeout(resolveWait,250));
  }
  assert.ok(ready,'local test server became ready');

  const registration=await fetch(`${origin}/api/auth/register`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({firstName:'Pendiente',lastName:'SMTP',email:pendingEmail,password})});
  assert.equal(registration.status,500,'SMTP delivery failure is reported generically for new accounts');
  const [pendingRows]=await pool.query<any[]>('SELECT id,email_verified_at FROM app_users WHERE email_normalized=?',[pendingEmail]);
  assert.equal(pendingRows.length,1);pendingId=Number(pendingRows[0].id);
  assert.equal(pendingRows[0].email_verified_at,null,'failed email delivery never verifies the account');
  const [verifyTokens]=await pool.query<any[]>('SELECT COUNT(*) total FROM email_verification_tokens WHERE user_id=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP()',[pendingId]);
  assert.equal(Number(verifyTokens[0].total),1,'the pending account can request a replacement link later');

  const login=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:adminEmail,password})});
  assert.equal(login.status,200);
  const auth=await login.json() as any;
  const setCookies=(login.headers as any).getSetCookie?.()??[login.headers.get('set-cookie')??''];
  const cookies=setCookies.flatMap((value:string)=>value.split(/,(?=[^;,]+=)/));
  const value=(name:string)=>cookies.map((cookie:string)=>cookie.trim()).find((cookie:string)=>cookie.startsWith(`${name}=`))?.split(';',1)[0].slice(name.length+1)??'';
  const sid=decodeURIComponent(value('oportuna.sid'));
  const csrf=decodeURIComponent(value('oportuna.csrf'))||auth.csrfToken;
  assert.ok(sid&&csrf);
  const invite=await fetch(`${origin}/api/company/members/invitations`,{method:'POST',headers:{Origin:origin,Cookie:`oportuna.sid=${encodeURIComponent(sid)}; oportuna.csrf=${encodeURIComponent(csrf)}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({email:invitedEmail,role:'collaborator'})});
  assert.equal(invite.status,500,'failed invitation email delivery is generic');
  const [invitationRows]=await pool.query<any[]>('SELECT accepted_at FROM company_invitations WHERE company_id=? AND invited_email=? ORDER BY id DESC LIMIT 1',[companyId,invitedEmail]);
  assert.equal(invitationRows.length,1);assert.equal(invitationRows[0].accepted_at,null,'failed delivery never accepts an invitation');
  const [membershipRows]=await pool.query<any[]>('SELECT COUNT(*) total FROM company_memberships m JOIN app_users u ON u.id=m.user_id WHERE m.company_id=? AND u.email_normalized=?',[companyId,invitedEmail]);
  assert.equal(Number(membershipRows[0].total),0,'failed delivery never creates a membership');

  const unknownReset=await fetch(`${origin}/api/auth/password-reset/request`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:`unknown-${suffix}@invalid.example`})});
  const existingReset=await fetch(`${origin}/api/auth/password-reset/request`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:adminEmail})});
  assert.equal(unknownReset.status,202);assert.equal(existingReset.status,202);
  assert.deepEqual(await unknownReset.json(),await existingReset.json(),'reset response remains neutral on SMTP failure');
  assert.ok(!childOutput.includes('QA-SECRET-MUST-NOT-APPEAR'),'SMTP secret is never logged');
  console.log('PASS local SMTP failure integration: registration remains unverified, invitation remains unaccepted without membership, password-reset response stays neutral; SMTP attempt was loopback-only.');
}catch(error){
  console.error('FAIL local SMTP failure integration:',error instanceof Error?error.message:'unknown error');
  process.exitCode=1;
}finally{
  if(child&&!child.killed){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolveWait=>setTimeout(resolveWait,5000))]);}
  try{
    if(companyId)await pool.execute('DELETE FROM companies WHERE id=?',[companyId]);
    if(pendingId)await pool.execute('DELETE FROM app_users WHERE id=?',[pendingId]);
    if(adminId)await pool.execute('DELETE FROM app_users WHERE id=?',[adminId]);
    const [[after]] = await pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) uniqueCodes FROM licitaciones');
    assert.equal(Number(after.total),Number(before.total));assert.equal(Number(after.uniqueCodes),Number(before.uniqueCodes));
    const [left]=await pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE nombre_comercial=?',[`TEMP SMTP FAILURE ${suffix}`]);
    assert.equal(Number(left[0].total),0,'temporary SMTP fixture was cleaned up');
  }catch(error){console.error('FAIL SMTP fixture cleanup:',error instanceof Error?error.message:'unknown error');process.exitCode=1;}
  await pool.end();
}
