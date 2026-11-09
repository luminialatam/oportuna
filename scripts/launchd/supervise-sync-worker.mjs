import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const projectRoot=resolve(dirname(scriptPath),'../..');
const logDirectory=resolve(homedir(),'Library/Logs/Oportuna');
const logFile=resolve(logDirectory,'sync-worker.log');
const maxLogBytes=5*1024*1024;
const retainedArchives=4;

mkdirSync(logDirectory,{recursive:true,mode:0o700});
chmodSync(logDirectory,0o700);
let logBytes=existsSync(logFile)?statSync(logFile).size:0;
function rotateLog(){
  for(let index=retainedArchives;index>=1;index--){
    const source=index===1?logFile:`${logFile}.${index-1}`;
    const target=`${logFile}.${index}`;
    if(existsSync(target))unlinkSync(target);
    if(existsSync(source))renameSync(source,target);
  }
  logBytes=0;
}
function log(chunk){
  let remaining=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk));
  while(remaining.length){
    if(logBytes>=maxLogBytes)rotateLog();
    const size=Math.min(remaining.length,maxLogBytes-logBytes);
    appendFileSync(logFile,remaining.subarray(0,size),{mode:0o600});
    chmodSync(logFile,0o600);
    logBytes+=size;
    remaining=remaining.subarray(size);
  }
}

const childEnvironment={...process.env,PROCESS_ROLE:'sync-worker',SYNC_SCHEDULER_ENABLED:'true',ENRICHMENT_WORKER_ENABLED:'false',ALERT_SCHEDULER_ENABLED:'false'};
const tsxRoot=resolve(projectRoot,'node_modules/tsx/dist');
const child=spawn(process.execPath,[
  '--require',resolve(tsxRoot,'preflight.cjs'),
  '--import',pathToFileURL(resolve(tsxRoot,'loader.mjs')).href,
  resolve(projectRoot,'server/src/index.ts'),
],{cwd:projectRoot,env:childEnvironment,stdio:['ignore','pipe','pipe']});

log(`${new Date().toISOString()} supervisor started; role=sync-worker scheduler=true\n`);
child.stdout.on('data',log);
child.stderr.on('data',log);
child.once('error',()=>{log(`${new Date().toISOString()} worker process failed to start\n`);process.exit(1);});
child.once('exit',(code,signal)=>{
  log(`${new Date().toISOString()} worker exited code=${code??'null'} signal=${signal??'none'}\n`);
  process.exit(code===0?0:1);
});

let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  if(stopping)return;
  stopping=true;
  log(`${new Date().toISOString()} supervisor received ${signal}; forwarding shutdown\n`);
  child.kill(signal);
  const timeout=setTimeout(()=>{child.kill('SIGKILL');process.exit(1);},15_000);
  timeout.unref();
});
