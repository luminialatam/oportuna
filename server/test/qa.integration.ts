import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { createSession, createUser, revokeSession } from '../src/authService.js';

const base=process.env.QA_TEST_BASE??'http://127.0.0.1:4000';
const origin=process.env.CLIENT_ORIGIN??'http://127.0.0.1:5173';
type Session={raw:string;csrf:string;userId:number;companyId:number};
const suffix=randomUUID();
let companyA=0,companyB=0,userA=0,userB=0,sessionA:Session|undefined,sessionB:Session|undefined;
let trackingId=0,listingCode='';
const interestBefore=new Map<string,any|null>();const interestChanges=new Map<string,number>();const initialInterest=new Map<string,any>();
const passed:string[]=[];const searchSummary:any[]=[];let initialListingCount=0;let initialItemCount=0;
function cookie(session:Session){return `oportuna.sid=${encodeURIComponent(session.raw)}; oportuna.csrf=${encodeURIComponent(session.csrf)}`;}
async function call(path:string,method='GET',body?:unknown,session?:Session,withCsrf=true){const headers=new Headers({Origin:origin});if(body!==undefined)headers.set('Content-Type','application/json');if(session)headers.set('Cookie',cookie(session));if(session&&withCsrf&&method!=='GET')headers.set('X-CSRF-Token',session.csrf);const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});let data:any={};try{data=await response.json();}catch{}return {status:response.status,data};}
async function isOk(result:Awaited<ReturnType<typeof call>>,label:string){assert.ok(result.status>=200&&result.status<300,`${label}: HTTP ${result.status}`);passed.push(label);return result.data;}
function product(name:string){return {nombre:name,categoria:'QA temporal',descripcion:'Registro temporal para QA aislado.',palabrasClave:['qa oportuna temporal'],sinonimos:[],terminosRelacionados:[],aplicaciones:[],exclusiones:[],activo:true};}

try{
  const [[listings],[inventory],[itemInventory]]=await Promise.all([pool.query<any[]>('SELECT codigo_externo FROM licitaciones ORDER BY fecha_cierre IS NULL,fecha_cierre ASC LIMIT 1'),pool.query<any[]>('SELECT COUNT(*) total FROM licitaciones'),pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items')]);initialListingCount=Number(inventory[0].total);initialItemCount=Number(itemInventory[0].total);assert.ok(listings[0]?.codigo_externo,'there is a stored listing to reference');listingCode=String(listings[0].codigo_externo);
  const [ca]=await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[`TEMP QA PRODUCT A ${suffix}`]);companyA=Number(ca.insertId);
  const [cb]=await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[`TEMP QA PRODUCT B ${suffix}`]);companyB=Number(cb.insertId);
  userA=await createUser(`qa-product-a-${suffix}@invalid.example`,'Temporary-QA-Password-2026!');userB=await createUser(`qa-product-b-${suffix}@invalid.example`,'Temporary-QA-Password-2026!');
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active'),(?,?,'collaborator','active')",[userA,companyA,userB,companyB]);
  const a=await createSession(userA,companyA);sessionA={raw:a.raw,csrf:a.csrf,userId:userA,companyId:companyA};const b=await createSession(userB,companyB);sessionB={raw:b.raw,csrf:b.csrf,userId:userB,companyId:companyB};
  assert.equal((await call('/api/resumen','GET',undefined,sessionA)).status,200);assert.equal((await call('/api/configuracion','GET',undefined,sessionA)).status,200);passed.push('Resumen y Configuración');
  const page=await isOk(await call('/api/licitaciones?page=1&pageSize=5'),'Licitaciones con paginación');assert.equal(page.items.length,5);
  await isOk(await call('/api/buscador/status'),'Estado de integración de búsqueda');
  await isOk(await call('/api/company/profile','GET',undefined,sessionA),'Lectura Mi empresa');
  const profile={nombreComercial:`TEMP QA ${suffix}`,razonSocial:'QA Temporal SpA',rut:null,actividad:'Prueba aislada',rubros:['QA temporal'],regiones:[],sitioWeb:null,palabrasClave:['qa temporal'],terminosExcluidos:[],estados:[5]};
  await isOk(await call('/api/company/profile','PUT',profile,sessionA),'Edición temporal de perfil');
  const savedProfile=await isOk(await call('/api/company/profile','GET',undefined,sessionA),'Persistencia temporal de perfil');assert.equal(savedProfile.profile.nombreComercial,profile.nombreComercial);
  const created=await isOk(await call('/api/company/catalog','POST',product(`Producto QA ${suffix}`),sessionA),'Creación temporal en Catálogo');const productId=Number(created.items[0].id);assert.ok(productId);
  const edited=await isOk(await call(`/api/company/catalog/${productId}`,'PATCH',product(`Producto QA editado ${suffix}`),sessionA),'Edición temporal en Catálogo');assert.ok(edited.items.some((item:any)=>item.id===productId&&item.nombre.includes('editado')));
  await isOk(await call(`/api/company/catalog/${productId}`,'DELETE',undefined,sessionA),'Eliminación exclusiva del producto QA');
  await isOk(await call('/api/company/matches','GET',undefined,sessionA),'Match personalizado');
  const [initialRows]=await pool.query<any[]>('SELECT codigo_externo,search_count,first_seen_at,last_seen_at FROM licitacion_search_interest');for(const row of initialRows)initialInterest.set(String(row.codigo_externo),row);
  for(const query of ['pendones','equipamiento médico','equipos de laboratorio','maquinaria alimentaria']){
    const result=await isOk(await call('/api/buscador/search','POST',{query,page:1,pageSize:10},sessionA),`Buscador IA: ${query}`);
    const codes:string[]=[...new Set<string>((result.items??[]).map((item:any)=>String(item.codigo_externo)).filter(Boolean))];
    for(const code of codes)interestChanges.set(code,(interestChanges.get(code)??0)+1);
    searchSummary.push({query,total:Number(result.total),provider:result.provider,topCodes:codes.slice(0,3)});
    if(query==='pendones'){
      const second=await isOk(await call('/api/buscador/search','POST',{query,page:2,pageSize:10,states:[5],matchLevel:'high'},sessionA),'Filtros y paginación del Buscador IA');
      const codes2:string[]=[...new Set<string>((second.items??[]).map((item:any)=>String(item.codigo_externo)).filter(Boolean))];for(const code of codes2)interestChanges.set(code,(interestChanges.get(code)??0)+1);
      assert.equal(second.page,2);
    }
  }
  for(const code of interestChanges.keys())interestBefore.set(code,initialInterest.get(code)??null);
  await isOk(await call(`/api/licitaciones/${encodeURIComponent(listingCode)}/local`),'Apertura de ficha local de solo lectura');
  const tracking=await isOk(await call('/api/company/tracking','POST',{codigo:listingCode},sessionA),'Guardar en Seguimiento');trackingId=Number(tracking.id);assert.ok(trackingId);
  const duplicate=await isOk(await call('/api/company/tracking','POST',{codigo:listingCode},sessionA),'Prevención de duplicados en Seguimiento');assert.equal(duplicate.created,false);
  await isOk(await call(`/api/company/tracking/${trackingId}`,'PATCH',{estado:'evaluating',notes:'Nota temporal QA'},sessionA),'Estado y nota temporal');
  const dueAt=new Date(Date.now()+60*60_000).toISOString();const date=await isOk(await call(`/api/company/tracking/${trackingId}/dates`,'POST',{label:'QA vence hoy',dueAt},sessionA),'Fecha temporal de seguimiento');
  await isOk(await call('/api/alerts/evaluate','POST',{},sessionA),'Evaluación de alertas temporal');const alerts=await isOk(await call('/api/alerts?filter=all','GET',undefined,sessionA),'Centro de alertas');const target=alerts.items.find((item:any)=>item.type.startsWith('followup_')&&item.opportunityId===trackingId);assert.ok(target,'temporary follow-up alert exists');
  await isOk(await call(`/api/alerts/${target.id}/read`,'POST',{},sessionA),'Marcar alerta temporal como leída');
  await isOk(await call(`/api/alerts/${target.id}/dismiss`,'POST',{},sessionA),'Descartar alerta temporal');
  const denied=await call('/api/company/tracking','GET',undefined,sessionB);assert.equal(denied.status,200);const crossWrite=await call(`/api/company/tracking/${trackingId}`,'PATCH',{notes:'cross-company attempt'},sessionB);assert.equal(crossWrite.status,404);passed.push('Aislamiento y rechazo de IDs cruzados');
  const csrfDenied=await call('/api/company/tracking','POST',{codigo:listingCode},sessionA,false);assert.equal(csrfDenied.status,403);passed.push('CSRF en operaciones de escritura');
  const deniedNoSession=await call('/api/company/tracking');assert.equal(deniedNoSession.status,401);passed.push('Rechazo sin sesión');
  await isOk(await call(`/api/company/tracking/${trackingId}`,'DELETE',undefined,sessionA),'Eliminación de seguimiento temporal');trackingId=0;
  console.log(JSON.stringify({passed,searches:searchSummary}));
}catch(error){console.error('QA funcional falló:',error instanceof Error?error.message:'error desconocido');process.exitCode=1;}
finally{
  try{
    if(trackingId&&sessionA)await call(`/api/company/tracking/${trackingId}`,'DELETE',undefined,sessionA).catch(()=>{});
    for(const [code,increments] of interestChanges){const previous=interestBefore.get(code);const [current]=await pool.query<any[]>('SELECT search_count,first_seen_at,last_seen_at FROM licitacion_search_interest WHERE codigo_externo=? LIMIT 1',[code]);if(previous){await pool.execute('UPDATE licitacion_search_interest SET search_count=?,first_seen_at=?,last_seen_at=? WHERE codigo_externo=?',[previous.search_count,previous.first_seen_at,previous.last_seen_at,code]);}else if(current[0]){const residual=Math.max(0,Number(current[0].search_count)-increments);if(residual===0)await pool.execute('DELETE FROM licitacion_search_interest WHERE codigo_externo=?',[code]);else await pool.execute('UPDATE licitacion_search_interest SET search_count=? WHERE codigo_externo=?',[residual,code]);}}
    if(sessionA)await revokeSession(sessionA.raw);if(sessionB)await revokeSession(sessionB.raw);
    if(companyA||companyB)await pool.execute('DELETE FROM companies WHERE id IN (?,?)',[companyA||-1,companyB||-1]);
    if(userA||userB)await pool.execute('DELETE FROM app_users WHERE id IN (?,?)',[userA||-1,userB||-1]);
    const [[left],[totals],[itemTotals]] = await Promise.all([pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE nombre_comercial LIKE ?',[`TEMP QA PRODUCT %`]),pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) unique_codes FROM licitaciones'),pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items')]);
    assert.equal(Number(left[0].total),0);assert.equal(Number(totals[0].total),initialListingCount);assert.equal(Number(totals[0].unique_codes),initialListingCount);assert.equal(Number(itemTotals[0].total),initialItemCount);
    console.log(`CLEANUP OK: empresas temporales eliminadas; ${initialListingCount} licitaciones únicas y ${initialItemCount} partidas intactas.`);
  }catch(error){console.error('ATENCIÓN: limpieza QA incompleta:',error instanceof Error?error.message:'error desconocido');process.exitCode=1;}
  await pool.end();
}
