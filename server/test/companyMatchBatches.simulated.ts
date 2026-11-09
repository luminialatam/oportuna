import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches } from '../src/companyService.js';

const originalQuery=pool.query;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async()=>{throw new Error('Match tests must remain local.');}) as typeof fetch;
const pageSize=250;
const totalRows=1_050;
const futureClose='2026-12-01T18:00:00.000Z';
const rows=Array.from({length:totalRows},(_,index)=>({
  id:index+1, codigo_externo:`SIM-${String(index+1).padStart(5,'0')}`,
  nombre:index===1_000||index===1_019?'Adquisición de computadores portátiles':`Compra local sin coincidencia ${index+1}`,
  codigo_estado:5,fecha_cierre:futureClose,organismo:'Organismo de prueba',monto_estimado:null,moneda:null,region:'Región de prueba',official_description:'',item_text:'',
}));
let batchQueries=0;
let baselineQueries=0;
let lastCursor=0;
const sourceRow={id:1,nombre:'Computadores portátiles',categoria:'Informática',descripcion:'',palabras_clave:'[]',sinonimos:'[]',terminos_relacionados:'[]',aplicaciones:'[]',exclusiones:'[]'};
(pool as any).query=async(sql:string,values:unknown[]=[]):Promise<[any[],unknown]>=>{
  if(sql.includes('FROM commercial_profiles'))return [[{actividad:'Informática',rubros:'["Informática y redes"]',regiones:'[]',palabras_clave:'[]',terminos_excluidos:'[]',updated_at:'2026-11-01'}],undefined];
  if(sql.includes('FROM company_search_preferences'))return [[{estados:'[5]',regiones:'[]',updated_at:'2026-11-01'}],undefined];
  if(sql.includes('FROM company_products'))return [Number(values[0])===1?[]:[sourceRow],undefined];
  if(sql.includes('MAX(last_synced_at)'))return [[{version:'2026-11-02'}],undefined];
  if(sql.includes('ORDER BY l.fecha_cierre IS NULL,l.fecha_cierre ASC,l.codigo_externo LIMIT ?')){
    baselineQueries++;
    assert.equal(Number(values[values.length-1]),800,'Baseline query should reproduce the historical cap.');
    return [rows.slice(0,800),undefined];
  }
  if(sql.includes('FROM (SELECT l.id FROM licitaciones l')){
    assert.match(sql,/l\.codigo_estado IN \(\?\)/,'Status filter must remain in each batch.');
    assert.match(sql,/l\.id>\?/,'Keyset pagination must advance by the last listing ID.');
    assert.match(sql,/LIMIT \?/,'Every database page must have a bounded size.');
    const cursor=Number(values[values.length-2]);
    assert.ok(cursor>=lastCursor,'Batch cursor must be monotonic.');
    lastCursor=cursor;
    batchQueries++;
    const page=rows.filter(row=>row.id>cursor).slice(0,pageSize);
    assert.equal(new Set(page.map(row=>row.codigo_externo)).size,page.length,'A batch cannot contain duplicate listing codes.');
    return [page,undefined];
  }
  throw new Error(`Unexpected SQL in Match simulation: ${sql.slice(0,100)}`);
};

try{
  const context={userId:7,role:'admin' as const,platformRole:'admin' as const,companyId:77};
  clearCompanyMatchCache();
  const before=await runWithCompanyContext(context,()=>getCompanyMatches({includeAllItems:true,evaluationLimit:800}));
  assert.equal(before.candidatesEvaluated,800);
  assert.equal(before.total,0,'The two positives after row 800 are absent from the capped baseline.');
  assert.equal(before.evaluation.queryCount,5,'Baseline uses four context queries and one candidate query.');
  clearCompanyMatchCache();lastCursor=0;batchQueries=0;
  const after=await runWithCompanyContext(context,()=>getCompanyMatches({includeAllItems:true}));
  assert.equal(after.candidatesEvaluated,totalRows,'Every eligible listing must be evaluated.');
  assert.equal(after.total,2,'Both positive listings beyond the old cap must be found.');
  assert.equal(after.high+after.medium+after.exploratory,after.total,'Match levels must partition matches.');
  assert.equal(after.items.length,2);
  assert.equal(new Set(after.items.map((item:any)=>item.codigo_externo)).size,after.items.length,'No duplicate results across pages.');
  assert.equal(after.evaluation.batches,5);
  assert.equal(after.evaluation.queryCount,9,'Full evaluation is four context queries plus five listing batches.');
  assert.ok(after.evaluation.durationMs>=0);
  assert.ok(after.evaluation.peakHeapDeltaBytes>=0);
  assert.equal(batchQueries,5);
  const isolated=await runWithCompanyContext({...context,companyId:1},()=>getCompanyMatches());
  assert.equal(isolated.configured,false,'An empty tenant must not inherit another company catalog.');
  assert.equal(isolated.total,0);
  assert.equal(baselineQueries,1);
  console.log('PASS simulated full Match: 1,050 bounded rows, 800-row baseline comparison, two late matches recovered, stable keyset batches, metrics and tenant isolation.');
}finally{
  (pool as any).query=originalQuery;
  globalThis.fetch=originalFetch;
}
