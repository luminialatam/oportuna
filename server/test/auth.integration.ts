import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { consumePasswordReset, createPasswordReset, createUser } from '../src/authService.js';

const base=process.env.AUTH_TEST_BASE??'http://127.0.0.1:4000';
const origin=process.env.CLIENT_ORIGIN??'http://127.0.0.1:5173';
const password='Temporary-QA-Password-2026!';
type CookieJar={sid:string;csrf:string};
function parseCookies(response:Response):CookieJar {
  const values=(response.headers as any).getSetCookie?.()??[response.headers.get('set-cookie')??''];
  const all=values.flatMap((value:string)=>value.split(/,(?=[^;,]+=)/));
  const get=(name:string)=>all.map((part:string)=>part.trim()).find((part:string)=>part.startsWith(`${name}=`))?.split(';',1)[0].slice(name.length+1)??'';
  return {sid:decodeURIComponent(get('oportuna.sid')),csrf:decodeURIComponent(get('oportuna.csrf'))};
}
async function req(path:string,options:RequestInit={},jar?:CookieJar){
  const headers=new Headers(options.headers);headers.set('Origin',origin);
  if(jar?.sid)headers.set('Cookie',`oportuna.sid=${encodeURIComponent(jar.sid)}; oportuna.csrf=${encodeURIComponent(jar.csrf)}`);
  if(jar?.csrf&& !['GET','HEAD'].includes((options.method??'GET').toUpperCase()))headers.set('X-CSRF-Token',jar.csrf);
  return fetch(`${base}${path}`,{...options,headers});
}
async function login(email:string){const response=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(response.status,200,`login ${email}`);const body=await response.json() as any;const cookies=parseCookies(response);assert.ok(cookies.sid&&cookies.csrf,'session and csrf cookies are set');assert.match(response.headers.get('set-cookie')??'',/HttpOnly/);assert.match(response.headers.get('set-cookie')??'',/SameSite=Lax/);assert.ok(body.csrfToken);const persisted=await req('/api/auth/session',{},cookies);assert.equal(persisted.status,200);assert.equal((await persisted.json() as any).authenticated,true);return {jar:cookies,body};}

const suffix=randomUUID();const emailA=`qa-auth-a-${suffix}@invalid.example`;const emailB=`qa-auth-b-${suffix}@invalid.example`;const emailAdminB=`qa-auth-admin-b-${suffix}@invalid.example`;const emailPlatform=`qa-auth-platform-${suffix}@invalid.example`;
let companyA=0,companyB=0,userA=0,userB=0,userAdminB=0,platformUser=0,trackingB=0,listingCode='';
let originalContext:number|null=null,contextChanged=false,legacyClaimed=false;
let jarA:CookieJar|undefined,jarB:CookieJar|undefined,jarAdminB:CookieJar|undefined,jarPlatform:CookieJar|undefined;
const checks:string[]=[];let initialListingCount=0;
try{
  const preflight=await fetch(`${base}/api/auth/login`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');checks.push('CORS permite únicamente origen configurado con credenciales');
  const rejectedOrigin=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'qa@invalid.example',password:'not-a-real-password'})});
  assert.equal(rejectedOrigin.status,403);checks.push('login rechaza Origin no configurado');
  const [[listings],[contexts],[inventory]] = await Promise.all([pool.query<any[]>('SELECT codigo_externo FROM licitaciones LIMIT 1'),pool.query<any[]>('SELECT company_id FROM company_local_context WHERE singleton_id=1'),pool.query<any[]>('SELECT COUNT(*) total FROM licitaciones')]);
  assert.ok(listings[0]?.codigo_externo,'an existing listing is available for isolated FK tests');listingCode=String(listings[0].codigo_externo);initialListingCount=Number(inventory[0].total);originalContext=contexts[0]?.company_id==null?null:Number(contexts[0].company_id);
  const [ca]=await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[`TEMP QA AUTH A ${suffix}`]);companyA=Number(ca.insertId);
  const [cb]=await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[`TEMP QA AUTH B ${suffix}`]);companyB=Number(cb.insertId);
  userA=await createUser(emailA,password);userB=await createUser(emailB,password);userAdminB=await createUser(emailAdminB,password);platformUser=await createUser(emailPlatform,password,'admin');
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active'),(?,?,'collaborator','active'),(?,?,'admin','active')",[userA,companyA,userB,companyB,userAdminB,companyB]);
  const [tracking]=await pool.execute<any>('INSERT INTO company_opportunity_tracking (company_id,codigo_externo) VALUES (?,?)',[companyB,listingCode]);trackingB=Number(tracking.insertId);
  const anon=await req('/api/company/tracking');assert.equal(anon.status,401);checks.push('rutas privadas requieren sesión');
  const badLogin=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:emailA,password:'Incorrecta'})});assert.equal(badLogin.status,401);
  const a=await login(emailA);jarA=a.jar;const b=await login(emailB);jarB=b.jar;const adminB=await login(emailAdminB);jarAdminB=adminB.jar;const platform=await login(emailPlatform);jarPlatform=platform.jar;checks.push('login correcto e incorrecto; cookies HttpOnly/SameSite');
  const noCsrf=await fetch(`${base}/api/company/tracking`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`oportuna.sid=${encodeURIComponent(jarA.sid)}; oportuna.csrf=${encodeURIComponent(jarA.csrf)}`},body:JSON.stringify({codigo:listingCode})});assert.equal(noCsrf.status,403);checks.push('CSRF bloquea mutación sin encabezado de token');
  const adminRead=await req('/api/company/profile',{},jarA);assert.equal(adminRead.status,200);
  const collaboratorRead=await req('/api/company/profile',{},jarB);assert.equal(collaboratorRead.status,200);const collaboratorWrite=await req('/api/company/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({nombreComercial:'No autorizado'})},jarB);assert.equal(collaboratorWrite.status,403);checks.push('colaborador puede consultar perfil, pero no editarlo');
  assert.equal((await req('/api/sync/jobs/current')).status,401);assert.equal((await req('/api/sync/jobs/current',{},jarA)).status,200);assert.equal((await req('/api/sync/jobs/current',{},jarB)).status,403);
  const syncWithoutCsrf=await fetch(`${base}/api/sync/jobs`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`oportuna.sid=${encodeURIComponent(jarA.sid)}; oportuna.csrf=${encodeURIComponent(jarA.csrf)}`},body:JSON.stringify({})});assert.equal(syncWithoutCsrf.status,403);checks.push('endpoints de sincronización protegidos por sesión/rol/CSRF');
  const aTracking=await (await req('/api/company/tracking',{},jarA)).json() as any;assert.ok(!aTracking.items.some((item:any)=>Number(item.id)===trackingB));
  const crossPatch=await req(`/api/company/tracking/${trackingB}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:'cross-tenant attempt'})},jarA);assert.equal(crossPatch.status,404);
  const forbiddenSwitch=await req('/api/auth/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:companyB})},jarA);assert.equal(forbiddenSwitch.status,403);checks.push('aislamiento de lectura/escritura y selección de empresa');
  await pool.execute("UPDATE company_memberships SET status='suspended' WHERE user_id=? AND company_id=?",[userB,companyB]);assert.equal((await req('/api/company/tracking',{},jarB)).status,403);await pool.execute("UPDATE company_memberships SET status='active' WHERE user_id=? AND company_id=?",[userB,companyB]);checks.push('membresía suspendida pierde acceso');
  const invitation=await req('/api/company/members/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:emailA,role:'collaborator'})},jarAdminB);assert.equal(invitation.status,201);const inviteBody=await invitation.json() as any;
  const accepted=await req('/api/auth/invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationToken:inviteBody.invitationToken})},jarA);assert.equal(accepted.status,200);const acceptedBody=await accepted.json() as any;const acceptedCookies=parseCookies(accepted);jarA={sid:acceptedCookies.sid||jarA.sid,csrf:acceptedCookies.csrf||acceptedBody.csrfToken};assert.ok(acceptedBody.memberships.some((m:any)=>m.companyId===companyB));checks.push('invitación aceptada por cuenta existente sin cambio de contraseña');
  const switched=await req('/api/auth/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:companyB})},jarA);assert.equal(switched.status,200);const switchedBody=await switched.json() as any;const switchedCookies=parseCookies(switched);jarA={sid:switchedCookies.sid||jarA.sid,csrf:switchedCookies.csrf||switchedBody.csrfToken};assert.equal(switchedBody.activeCompanyId,companyB);checks.push('cambio a membresía autorizada');
  const [existingClaims]=await pool.query<any[]>('SELECT company_id,claimed_by FROM legacy_company_claims WHERE singleton_id=1');
  if(existingClaims.length){const pending=await req('/api/platform/legacy-company/pending',{},jarPlatform);assert.equal(pending.status,200);assert.equal((await pending.json() as any).available,false);const wrongCompany=await req('/api/platform/legacy-company/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:companyA})},jarPlatform);assert.equal(wrongCompany.status,409);checks.push('reclamo heredado ya consumido; vínculo real preservado');}
  else{await pool.execute('UPDATE company_local_context SET company_id=? WHERE singleton_id=1',[companyA]);contextChanged=true;const claim=await req('/api/platform/legacy-company/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:companyA})},jarPlatform);assert.equal(claim.status,200);legacyClaimed=true;const claimBody=await claim.json() as any;const claimCookies=parseCookies(claim);jarPlatform={sid:claimCookies.sid||jarPlatform.sid,csrf:claimCookies.csrf||claimBody.csrfToken};checks.push('vinculación heredada temporal y única');const duplicateClaim=await req('/api/platform/legacy-company/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId:companyA})},jarPlatform);assert.equal(duplicateClaim.status,409);checks.push('reclamo heredado de un solo uso');}
  await pool.execute('UPDATE app_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE user_id=? AND revoked_at IS NULL',[userB]);assert.equal((await req('/api/company/tracking',{},jarB)).status,401);jarB=(await login(emailB)).jar;checks.push('sesión vencida rechazada');
  const reset=await createPasswordReset(emailB);assert.ok(reset);assert.equal((await req('/api/company/tracking',{},jarB)).status,200);const consumed=await consumePasswordReset(reset!.token,'Temporary-QA-Reset-Password-2026!');assert.equal(consumed,true);const resetSession=await req('/api/company/tracking',{},jarB);assert.equal(resetSession.status,401);assert.equal(await consumePasswordReset(reset!.token,'Temporary-QA-Reset-Password-2026!'),false);checks.push('token de restablecimiento de un uso revoca sesiones');
  const logout=await req('/api/auth/logout',{method:'POST'},jarA);assert.equal(logout.status,200);assert.equal((await req('/api/company/tracking',{},jarA)).status,401);checks.push('logout revoca sesión');
  console.log(`PASS ${checks.length} comprobaciones de autenticación y aislamiento temporal.`);for(const check of checks)console.log(`- ${check}`);
}catch(error){console.error('Fallo en prueba temporal de autenticación:',error instanceof Error?error.message:'error desconocido');process.exitCode=1;}
finally{
  try{
    if(contextChanged)await pool.execute('UPDATE company_local_context SET company_id=? WHERE singleton_id=1',[originalContext]);
    if(legacyClaimed)await pool.execute('DELETE FROM legacy_company_claims WHERE singleton_id=1 AND company_id=? AND claimed_by=?',[companyA,platformUser]);
    if(companyA||companyB)await pool.execute('DELETE FROM companies WHERE id IN (?,?)',[companyA||-1,companyB||-1]);
    if(userA||userB||userAdminB||platformUser)await pool.execute('DELETE FROM app_users WHERE id IN (?,?,?,?)',[userA||-1,userB||-1,userAdminB||-1,platformUser||-1]);
    const [[remaining],[counts]] = await Promise.all([pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE nombre_comercial LIKE \'TEMP QA AUTH %\''),pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) unique_codes FROM licitaciones')]);
    assert.equal(Number(remaining[0].total),0,'temporary company fixtures removed');
    assert.equal(Number(counts[0].total),initialListingCount,'listing count remains intact');assert.equal(Number(counts[0].unique_codes),initialListingCount,'listing codes remain unique');
    console.log(`CLEANUP OK: fixtures removed; existing listings remain ${initialListingCount} unique.`);
  }catch(error){console.error('ATENCIÓN: no se pudo completar la limpieza temporal:',error instanceof Error?error.message:'error desconocido');process.exitCode=1;}
  await pool.end();
}
