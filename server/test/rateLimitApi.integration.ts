import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import pool from '../src/db.js';
import { createSession, createUser } from '../src/authService.js';

const suffix=randomUUID();
const origin='http://127.0.0.1:5173';
const fakeSyncToken='rate-limit-local-test-token-000000000';
let companyId=0,userId=0;
let rawSession='',csrfToken='';
const processes:ChildProcess[]=[];
const ipCandidates=['::ffff:127.0.0.1','127.0.0.1','::1'];
const accountEmail=`rate-limit-${suffix}@invalid.example`;
const scopedKeys=(ip:string)=>[
  `login-ip:${ip}:POST:/api/auth/login`,
  `login-account:${ip}:${accountEmail}`,
  `request:${ip}:POST:/api/buscador/search`,
  `request:${ip}:POST:/api/buscador/analysis/:codigo`,
  `sync:${ip}:POST:/api/sync/jobs`,
  `request:${ip}:POST:/api/buscador/enrichment`,
];
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
async function freePort(){return await new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string')return reject(new Error('No se pudo reservar puerto local.'));const port=a.port;s.close(e=>e?reject(e):resolve(port));});});}
async function startApi():Promise<{child:ChildProcess;base:string}>{
  const port=await freePort();
  const child=spawn(process.execPath,['--import','tsx','server/src/index.ts'],{cwd:process.cwd(),env:{
    ...process.env,APP_ENV:'development',NODE_ENV:'development',PROCESS_ROLE:'web',HOST:'127.0.0.1',PORT:String(port),
    TRUST_PROXY_HOPS:'0',CLIENT_ORIGIN:origin,RATE_LIMIT_SHARED:'true',GROQ_API_KEY:'',SYNC_API_TOKEN:fakeSyncToken,
    SYNC_SCHEDULER_ENABLED:'false',ENRICHMENT_WORKER_ENABLED:'false',ALERT_SCHEDULER_ENABLED:'false',
  },stdio:['ignore','pipe','pipe']});
  processes.push(child);
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++){
    if(child.exitCode!=null)throw new Error('API de prueba terminó antes de iniciar.');
    try{const res=await fetch(`${base}/api/health`);if(res.ok){const data=await res.json() as any;if(data.mysql)return{child,base};}}catch{/* wait until local listener is ready */}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('API de prueba no quedó disponible.');
}
async function stopApi(child:ChildProcess){if(child.exitCode!=null)return;child.kill('SIGTERM');await Promise.race([once(child,'close'),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode==null)child.kill('SIGKILL');}
async function call(base:string,path:string,options:RequestInit={},auth=false){
  const headers=new Headers(options.headers);headers.set('Origin',origin);
  if(auth){headers.set('Cookie',`oportuna.sid=${encodeURIComponent(rawSession)}; oportuna.csrf=${encodeURIComponent(csrfToken)}`);headers.set('X-CSRF-Token',csrfToken);}
  return fetch(`${base}${path}`,{...options,headers});
}
async function cleanCounters(){
  const keys=ipCandidates.flatMap(scopedKeys).map(hash);
  await pool.execute(`DELETE FROM app_rate_limits WHERE key_hash IN (${keys.map(()=>'?').join(',')})`,keys);
}

try{
  const [ca]=await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[`TEMP RATE LIMIT ${suffix}`]);companyId=Number(ca.insertId);
  userId=await createUser(`rate-user-${suffix}@invalid.example`,'Temporary-Rate-Limit-Password-2026!');
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')",[userId,companyId]);
  const session=await createSession(userId,companyId);rawSession=session.raw;csrfToken=session.csrf;
  const apiA=await startApi();const apiB=await startApi();

  for(let i=0;i<10;i++){
    const response=await call(i%2?apiB.base:apiA.base,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accountEmail,password:'incorrecta para test'})});
    assert.equal(response.status,401,'first ten failed account logins should be allowed and counted');
  }
  const blockedLogin=await call(apiB.base,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accountEmail,password:'incorrecta para test'})});
  assert.equal(blockedLogin.status,429,'account failure limit must be visible across API processes');

  for(let i=0;i<30;i++){
    const response=await call(i%2?apiB.base:apiA.base,'/api/buscador/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'x'})},true);
    assert.equal(response.status,400,'invalid search should stop after rate counter without Groq or query side effects');
  }
  assert.equal((await call(apiB.base,'/api/buscador/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'x'})},true)).status,429);

  for(let i=0;i<8;i++){
    const response=await call(i%2?apiB.base:apiA.base,'/api/buscador/analysis/__rate_limit_missing_listing__',{method:'POST'},true);
    assert.equal(response.status,404,'missing local listing must not call Mercado Público or Groq');
  }
  assert.equal((await call(apiB.base,'/api/buscador/analysis/__rate_limit_missing_listing__',{method:'POST'},true)).status,429);

  for(let i=0;i<2;i++){
    const response=await call(i%2?apiB.base:apiA.base,'/api/sync/jobs',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${fakeSyncToken}`},body:JSON.stringify({dateFrom:'invalid',dateTo:'invalid'})});
    assert.equal(response.status,400,'invalid sync body should be rejected before creating a job');
  }
  assert.equal((await call(apiB.base,'/api/sync/jobs',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${fakeSyncToken}`},body:JSON.stringify({dateFrom:'invalid',dateTo:'invalid'})})).status,429);

  for(let i=0;i<5;i++){
    const response=await call(i%2?apiB.base:apiA.base,'/api/buscador/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})},true);
    assert.equal(response.status,400,'invalid enrichment body should be rejected before queueing');
  }
  assert.equal((await call(apiB.base,'/api/buscador/enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})},true)).status,429);

  await stopApi(apiA.child);await stopApi(apiB.child);
  assert.equal(apiA.child.exitCode,0,'first API process should complete graceful shutdown');
  assert.equal(apiB.child.exitCode,0,'second API process should complete graceful shutdown');
  await cleanCounters();
  console.log('PASS shared limits enforced through two live API processes for login, search, analysis, sync and enrichment; invalid probes caused no external work.');
}catch(error){
  console.error('Two-process API rate limit test failed:',error instanceof Error?error.message:'unknown error');process.exitCode=1;
}finally{
  for(const child of processes)await stopApi(child);
  await cleanCounters();
  if(rawSession)await pool.execute('DELETE FROM app_sessions WHERE token_hash=SHA2(?,256)',[rawSession]).catch(()=>{});
  if(userId)await pool.execute('DELETE FROM app_sessions WHERE user_id=?',[userId]).catch(()=>{});
  if(userId)await pool.execute('DELETE FROM company_memberships WHERE user_id=?',[userId]).catch(()=>{});
  if(userId)await pool.execute('DELETE FROM app_users WHERE id=?',[userId]).catch(()=>{});
  if(companyId)await pool.execute('DELETE FROM companies WHERE id=?',[companyId]).catch(()=>{});
  await pool.end();
}
