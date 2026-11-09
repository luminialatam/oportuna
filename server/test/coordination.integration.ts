import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pool from '../src/db.js';

function startHolder(name:string){
  const child=spawn(process.execPath,['--import','tsx','server/test/lockWorker.ts'],{cwd:process.cwd(),env:{...process.env,LOCK_TEST_NAME:name,LOCK_TEST_MODE:'hold'},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{output+=chunk;});
  return {child,getOutput:()=>output};
}
async function waitForText(holder:ReturnType<typeof startHolder>,text:string){
  for(let i=0;i<100;i++){if(holder.getOutput().includes(text))return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw new Error(`lock subprocess did not report ${text}`);
}
async function acquireAndRelease(name:string){
  const child=spawn(process.execPath,['--import','tsx','server/test/lockWorker.ts'],{cwd:process.cwd(),env:{...process.env,LOCK_TEST_NAME:name,LOCK_TEST_MODE:'try'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{output+=chunk;});
  const [code]=await once(child,'close');return {code,output};
}

const lockNames=['oportuna_sync_worker','oportuna_enrichment_worker','oportuna_alert_evaluation','oportuna_mercado_publico_request'];
try{
  for(const name of lockNames){
    const holder=startHolder(name);await waitForText(holder,'LOCKED');
    const busy=await acquireAndRelease(name);assert.equal(busy.output.trim(),'BUSY',`${name} should be exclusive across processes`);
    holder.child.kill('SIGTERM');await once(holder.child,'close');
    const recovered=await acquireAndRelease(name);assert.equal(recovered.output.trim(),'LOCKED',`${name} should be released when the holder exits`);
    assert.equal(recovered.code,0);
  }
  console.log('PASS named locks serialize four worker/API operations and recover after process termination.');
}catch(error){
  console.error('Worker coordination test failed:',error instanceof Error?error.message:'unknown error');
  process.exitCode=1;
}finally{await pool.end();}
