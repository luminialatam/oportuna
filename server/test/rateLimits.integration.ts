import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pool from '../src/db.js';
import { MysqlRateLimitStore } from '../src/rateLimitStore.js';

const execFileAsync=promisify(execFile);
const suffix=randomUUID();
const ip='::ffff:127.0.0.1';
const concurrentKey=`coordination-concurrency:${suffix}`;
const expiringKey=`expiry:${suffix}`;
const expiredKeyHash=createHash('sha256').update(`expired-cleanup:${suffix}`).digest('hex');
const cleanupTriggerKey=`cleanup-trigger:${suffix}`;
const scopes=[
  {key:`login-ip:${ip}:POST:/api/auth/login`,limit:1,windowMs:60_000},
  {key:`login-account:${ip}:rate-qa-${suffix}@invalid.example`,limit:1,windowMs:60_000},
  {key:`request:${ip}:POST:/api/buscador/search`,limit:1,windowMs:60_000},
  {key:`request:${ip}:POST:/api/buscador/analysis/:codigo`,limit:1,windowMs:60_000},
  {key:`sync:${ip}:POST:/api/sync/jobs`,limit:1,windowMs:60_000},
  {key:`request:${ip}:POST:/api/buscador/enrichment`,limit:1,windowMs:60_000},
];
const keyHash=(key:string)=>createHash('sha256').update(key).digest('hex');
async function childConsume(cases:typeof scopes){
  const {stdout}=await execFileAsync(process.execPath,['--import','tsx','server/test/rateLimitWorker.ts'],{
    cwd:process.cwd(),env:{...process.env,RATE_LIMIT_TEST_CASES:JSON.stringify(cases)},maxBuffer:1024*1024,
  });
  return JSON.parse(stdout) as {allowed:boolean}[];
}
async function cleanTestRows(){
  const hashes=[...scopes.map(item=>keyHash(item.key)),keyHash(concurrentKey),keyHash(expiringKey),expiredKeyHash,keyHash(cleanupTriggerKey)];
  await pool.execute(`DELETE FROM app_rate_limits WHERE key_hash IN (${hashes.map(()=>'?').join(',')})`,hashes);
}

try{
  const [exists]=await pool.query<any[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_rate_limits'");
  assert.ok(exists.length,'rate limit migration 013 must be applied before shared-store tests');
  await cleanTestRows();
  const first=await childConsume(scopes);
  const second=await childConsume(scopes);
  assert.ok(first.every(result=>result.allowed),'first process should consume each isolated test bucket');
  assert.ok(second.every(result=>!result.allowed),'second process must observe all six shared buckets');

  const concurrentCase=[{key:concurrentKey,limit:1,windowMs:60_000}];
  const simultaneous=await Promise.all([childConsume(concurrentCase),childConsume(concurrentCase)]);
  assert.ok(simultaneous.flat().filter(result=>result.allowed).length<=1,'concurrent processes must not both pass a single-hit bucket');
  const [[count]]=await pool.query<any[]>('SELECT hit_count FROM app_rate_limits WHERE key_hash=? AND window_start_ms=?',[keyHash(concurrentKey),Math.floor(Date.now()/60_000)*60_000]);
  assert.equal(Number(count?.hit_count),2,'both concurrent requests must be counted');

  const store=new MysqlRateLimitStore();const now=Date.now();
  assert.equal((await store.consume(expiringKey,1,1000,now)).allowed,true);
  assert.equal((await store.check(expiringKey,1,1000,now+1000)).allowed,true,'a new fixed-window bucket must expire the prior limit');
  await pool.execute('INSERT INTO app_rate_limits (key_hash,window_start_ms,hit_count,expires_at) VALUES (?, ?, 1, DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND))',[expiredKeyHash,now-600_000]);
  await new MysqlRateLimitStore().consume(cleanupTriggerKey,1,60_000);
  const [expired]=await pool.execute<any[]>('SELECT key_hash FROM app_rate_limits WHERE key_hash=?',[expiredKeyHash]);
  assert.equal(expired.length,0,'expired counters should be pruned');

  await cleanTestRows();
  console.log('PASS MySQL rate limits shared across two processes; tested login, search, analysis, sync, enrichment, concurrent increments, expiry and cleanup.');
}catch(error){
  console.error('Shared rate limit integration test failed:',error instanceof Error?error.message:'unknown error');
  process.exitCode=1;
}finally{
  await cleanTestRows();
  await pool.end();
}
