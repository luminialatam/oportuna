import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches, getCompanyWorkspace, saveCompanyProduct, saveCompanyProfile } from '../src/companyService.js';
import { previewEnrichmentCandidates, type EnrichmentCandidate } from '../src/listingEnrichment.js';
import { scoreCatalogMatch } from '../src/commercialMatching.js';

if(!['localhost','127.0.0.1','::1'].includes((process.env.DB_HOST||'127.0.0.1').toLowerCase()))throw new Error('Only local MySQL is allowed.');
globalThis.fetch=(async()=>{throw new Error('External requests are disabled in Match benchmark.');}) as typeof fetch;
type OfferType='product_supply'|'service'|'installation'|'maintenance_repair'|'rental'|'construction';
type P={nombre:string;categoria:string;palabrasClave:string[];sinonimos:string[];terminosRelacionados:string[];aplicaciones:string[];exclusiones:string[];tiposComerciales:OfferType[]};
const p=(nombre:string,categoria:string,keywords:string[],synonyms:string[]=[],related:string[]=[],applications:string[]=[],exclusions:string[]=[],types:OfferType[]=['product_supply']):P=>({nombre,categoria,palabrasClave:keywords,sinonimos:synonyms,terminosRelacionados:related,aplicaciones:applications,exclusiones:exclusions,tiposComerciales:types});
const fixture:Record<string,P[]>={
 'Impresión, pendones y publicidad':[
  p('Pendones publicitarios','Impresión gráfica',['impresión de pendones','pendones informativos'],['banner impreso','pendón roller'],['producción de material gráfico'],['eventos institucionales'],['arriendo publicitario'],['product_supply','service']),
  p('Señalética institucional','Señalización y gráfica',['señalética informativa','letreros de señalización'],['señalización institucional'],['gráfica adhesiva'],['seguridad y orientación de recintos'],['señalización vial de obras'],['product_supply','service','installation']),
  p('Impresión de gran formato','Imprenta',['impresión gran formato','impresión de afiches'],['impresión digital comercial'],['material publicitario impreso'],['publicidad gráfica'],['licencias digitales'],['product_supply','service']),
 ],
 'Informática y redes':[
  p('Computadores portátiles','Computación',['notebook empresarial','computador portátil'],['laptop'],['equipos computacionales'],['puestos de trabajo'],['arriendo de computadores']),
  p('Servidores y almacenamiento','Infraestructura TI',['servidor rack','servidor de datos'],['servidor empresarial','almacenamiento nas'],['centro de datos'],['infraestructura TI'],['servicio hosting']),
  p('Equipos de redes informáticas','Redes',['switch ethernet','router empresarial','punto de acceso wifi'],['equipos networking','access point'],['conectividad LAN'],['red informática institucional'],['redes de alcantarillado']),
  p('Cableado estructurado','Telecomunicaciones',['cableado estructurado cat 6','fibra óptica de datos'],['instalación fibra óptica'],['infraestructura telecomunicaciones'],['redes de datos'],['cableado eléctrico domiciliario'],['product_supply','installation']),
 ],
 'Equipamiento médico':[
  p('Monitores multiparámetro','Equipamiento médico',['monitor multiparámetro','monitor de signos vitales'],['monitor paciente','monitor clínico'],['monitorización clínica'],['unidad de paciente'],['monitores de computador']),
  p('Camas clínicas eléctricas','Mobiliario clínico',['cama clínica eléctrica','cama hospitalaria articulada'],['cama de paciente'],['mobiliario hospitalario'],['hospitalización'],['ropa de cama']),
  p('Desfibriladores','Emergencia médica',['desfibrilador externo automático','desfibrilador manual'],['DEA'],['equipos reanimación'],['urgencia hospitalaria'],['redes eléctricas']),
  p('Ecógrafos y equipos de imagenología','Diagnóstico médico',['ecógrafo portátil','ecógrafo ocular','rayos x digital'],['ecógrafo','radiología digital'],['diagnóstico por imágenes'],['centros clínicos'],['gráfica digital']),
 ],
 'Equipamiento de laboratorio':[
  p('Centrífugas de laboratorio','Equipos laboratorio',['centrífuga de laboratorio','centrífuga refrigerada'],['centrifugadora clínica'],['separación de muestras'],['laboratorio clínico'],['centrifugado de hormigón']),
  p('Balanzas analíticas','Instrumentos analíticos',['balanza analítica precisión','microbalanza laboratorio'],['balanza de laboratorio'],['pesaje de muestras'],['laboratorio de ensayos'],['balanza comercial']),
  p('Microscopios ópticos','Microscopía',['microscopio óptico laboratorio','microscopio binocular'],['microscopía óptica'],['observación de muestras'],['investigación científica'],['microscopio virtual']),
  p('Espectrofotómetros','Instrumentos analíticos',['espectrofotómetro UV visible','espectrómetro absorción'],['equipo espectrofotométrico'],['análisis de muestras'],['laboratorio químico'],['espectáculos audiovisuales']),
 ],
 'Construcción y mantención':[
  p('Obras civiles y edificación','Construcción',['construcción edificio','obra civil infraestructura','edificación pública'],['ejecución obras civiles'],['construcción de recintos'],['infraestructura sanitaria y educacional'],['software construcción datos'],['construction']),
  p('Mantención de edificios','Mantención',['mantención edificio institucional','reparación de infraestructura'],['conservación edificios','reparación inmueble'],['mantención de inmuebles'],['recintos públicos'],['mantención vehículos'],['service','maintenance_repair']),
  p('Pavimentación vial','Obras viales',['pavimentación calles','reposición pavimento','asfalto vial'],['obras pavimentación'],['conservación vial'],['calles y caminos'],['pavimento de goma gimnasio'],['construction']),
  p('Instalaciones sanitarias de edificios','Obras sanitarias',['red de agua potable interior','instalación sanitaria edificio','alcantarillado recinto'],['obras sanitarias'],['redes sanitarias'],['edificios públicos'],['agua embotellada'],['installation','construction']),
  p('Instalaciones eléctricas de edificios','Obras eléctricas',['instalación eléctrica edificio','tablero eléctrico obra'],['normalización eléctrica recinto'],['infraestructura eléctrica'],['recintos institucionales'],['material eléctrico solamente'],['installation','construction']),
 ],
 'Maquinaria y equipamiento alimentario':[
  p('Molinos coloidales','Maquinaria alimentaria',['molino homogenizador coloidal','molino rotor estator'],['homogeneizador coloidal','molino de emulsiones'],['molienda coloidal'],['emulsificación industrial'],['arriendo de maquinaria']),
  p('Molinos para harina','Maquinaria de molienda',['molino harinero','molino de trigo','molino de granos'],['molino industrial para harina'],['producción de harina'],['molienda de cereales'],['arriendo de maquinaria']),
  p('Prensas de aceite','Extracción de aceites',['prensa oleaginosa','prensa extracción aceite'],['expeller de aceite','prensa de aceite vegetal'],['extracción aceite vegetal'],['semillas oleaginosas'],['arriendo de maquinaria']),
  p('Hornos industriales para alimentos','Equipos térmicos',['horno industrial alimentos','horno convector industrial','horno rotatorio'],['horno panadería industrial','horno cocina industrial'],['cocción industrial'],['panadería industrial'],['arriendo de maquinaria']),
  p('Equipamiento gastronómico','Cocina profesional',['cocina industrial','equipamiento cocina profesional','equipo gastronómico profesional'],['equipo cocina institucional'],['cocina restaurante'],['casinos institucionales'],['utensilios domésticos']),
  p('Procesamiento industrial de alimentos','Servicios de proceso',['procesamiento industrial alimentos','elaboración industrial alimentos'],['producción alimentos procesados'],['maquila de alimentos'],['procesamiento por contrato'],['servicios alimentación colectiva'],['service']),
  p('Lavavajillas industriales','Equipos lavado cocina',['lavavajillas industrial capota','lavavajillas de túnel','lavalozas industrial'],['máquina lavavajillas comercial'],['lavado vajilla alto volumen'],['cocinas institucionales'],['arriendo de maquinaria']),
  p('Instalación de maquinaria alimentaria','Instalación industrial',['instalación molinos coloidales','instalación molinos harineros','instalación prensas aceite','montaje hornos industriales alimentos','instalación lavavajillas industrial'],['montaje maquinaria alimentos'],['comisionamiento maquinaria alimentaria'],['montaje equipos cocina industrial'],['reparación de maquinaria','mantención correctiva'],['installation','service']),
 ],
};
const ids:Array<{id:number;name:string}>=[];
const previewBySector = new Map<string, EnrichmentCandidate[]>();
let previewEligibleBySector: Record<string, number> = {};
let previewCoverage: any = null;
try{
 const [[users],[companyOne],[beforeListings],[beforeItems]]=await Promise.all([
  pool.query<any[]>("SELECT id FROM app_users WHERE status='active' ORDER BY (platform_role='admin') DESC,id LIMIT 1"),
  pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1'),
  pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) unique_codes FROM licitaciones'),
  pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items'),
 ]);
 assert.ok(users.length);const userId=Number(users[0].id);const company1Count=Number(companyOne[0].total);const output:any={eligibleListings:0,inventory:{before:beforeListings[0],itemsBefore:Number(beforeItems[0].total)},sectors:[]};
 const [eligibility]=await pool.query<any[]>("SELECT COUNT(*) total FROM licitaciones WHERE codigo_estado=5 AND (fecha_cierre IS NULL OR fecha_cierre>=UTC_TIMESTAMP())");output.eligibleListings=Number(eligibility[0].total);
 for(const [sector,products] of Object.entries(fixture)){
  const companyName=`TEMP F50 ${randomUUID()} ${sector}`;const conn=await pool.getConnection();let id=0;
  try{await conn.beginTransaction();const [c]=await conn.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)',[companyName]);id=Number(c.insertId);await conn.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')",[userId,id]);await conn.commit();}catch(error){await conn.rollback();throw error;}finally{conn.release();}
  ids.push({id,name:companyName});
  await runWithCompanyContext({userId,companyId:id,role:'admin',platformRole:'admin'},async()=>{
   await saveCompanyProfile({nombreComercial:companyName,razonSocial:null,rut:null,actividad:sector,rubros:[sector],regiones:[],sitioWeb:'',palabrasClave:[],terminosExcluidos:[],estados:[5]});
 for(const product of products)await saveCompanyProduct({...product,descripcion:`Oferta comercial para ${product.nombre}.`,activo:true});
   assert.equal((await getCompanyWorkspace()).products.filter((p:any)=>p.activo).length,products.length);
  });
  const preview = await previewEnrichmentCandidates(products.map(product => ({ ...product, activo: true })));
  previewBySector.set(sector, preview.candidates);
  previewEligibleBySector[sector] = preview.eligibleCandidates;
  previewCoverage = preview.coverage;
  const context={userId,companyId:id,role:'admin' as const,platformRole:'admin' as const};
  clearCompanyMatchCache();const before=await runWithCompanyContext(context,()=>getCompanyMatches({includeAllItems:true,commercialClassification:false}));
  clearCompanyMatchCache();const after=await runWithCompanyContext(context,()=>getCompanyMatches({includeAllItems:true}));
  if(sector==='Impresión, pendones y publicidad')assert.ok((after.items as any[]).some(row=>row.codigo_externo==='609-29-LE26'),'The known pendones positive control must remain a match.');
  if(sector==='Maquinaria y equipamiento alimentario'){
   const dishwasherProduct=products.find(product=>product.nombre==='Lavavajillas industriales');assert.ok(dishwasherProduct,'The food fixture must include the industrial dishwasher product.');
   const [historicalRows]=await pool.query<any[]>(`SELECT l.codigo_estado,l.nombre,l.fecha_cierre,
     COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Descripcion')),'') description,
     COALESCE((SELECT GROUP_CONCAT(DISTINCT CONCAT_WS(' ',i.nombre,i.descripcion,i.categoria,i.search_text) SEPARATOR ' ') FROM licitacion_items i WHERE i.codigo_externo=l.codigo_externo),'') item_text
     FROM licitaciones l WHERE l.codigo_externo='2111-335-LE26'`);
   assert.ok(historicalRows[0],'The official dishwasher compatibility control must exist locally.');
   const historical=historicalRows[0];
   const historicalEvidence=scoreCatalogMatch(dishwasherProduct,historical.nombre,historical.description,historical.item_text);
   assert.equal(historicalEvidence?.level,'high','The dishwasher remains a strong historical commercial compatibility control.');
   const isClosed=historical.fecha_cierre!=null&&new Date(historical.fecha_cierre).getTime()<Date.now();
   const appearsAsOpen=(after.items as any[]).some(row=>row.codigo_externo==='2111-335-LE26');
   if(isClosed)assert.equal(appearsAsOpen,false,'A closed historical control must not appear among open opportunities.');
   else assert.equal(appearsAsOpen,true,'An eligible dishwasher control must appear in open opportunities.');
   output.historicalCompatibilityControl={code:'2111-335-LE26',score:historicalEvidence.score,level:historicalEvidence.level,closed:isClosed,appearsAsOpenOpportunity:appearsAsOpen};
  }
  const beforeRows=new Map((before.items as any[]).map(row=>[row.codigo_externo,row]));
  const afterRows=new Map((after.items as any[]).map(row=>[row.codigo_externo,row]));
  const added=(after.items as any[]).filter(row=>!beforeRows.has(row.codigo_externo));
  const removed=(before.items as any[]).filter(row=>!afterRows.has(row.codigo_externo));
  const demoted=(after.items as any[]).filter(row=>beforeRows.has(row.codigo_externo)&&beforeRows.get(row.codigo_externo).level!=='exploratory'&&row.level==='exploratory');
  output.sectors.push({
   sector, products: products.length,
   before: { evaluated: before.candidatesEvaluated, matches: before.total, high: before.high, medium: before.medium, exploratory: before.exploratory, durationMs: before.evaluation.durationMs, queries: before.evaluation.queryCount },
   after: { evaluated: after.candidatesEvaluated, matches: after.total, high: after.high, medium: after.medium, exploratory: after.exploratory, durationMs: after.evaluation.durationMs, queries: after.evaluation.queryCount, batches: after.evaluation.batches, batchSize: after.evaluation.batchSize, peakHeapDeltaBytes: after.evaluation.peakHeapDeltaBytes, indexed: after.coverage.indexed, limited: after.coverage.limited, title: (after.items as any[]).filter(x => x.evidenceSources.includes('título')).length, description: (after.items as any[]).filter(x => x.evidenceSources.includes('descripción oficial')).length, items: (after.items as any[]).filter(x => x.evidenceSources.includes('partidas indexadas')).length },
   removedTotal: removed.length, removedExamples: removed.slice(0, 3).map(({ codigo_externo, nombre, productName, score, level }: any) => ({ code: codigo_externo, title: nombre, product: productName, score, level })),
   newMatches: added.length, demotedTotal: demoted.length, demotedExamples: demoted.slice(0, 3).map(({ codigo_externo, nombre, productName, score, level }: any) => ({ code: codigo_externo, title: nombre, product: productName, score, level })),
  });
 }
 const isolated=await runWithCompanyContext({userId,companyId:1,role:'admin',platformRole:'admin'},()=>getCompanyMatches());assert.equal(isolated.configured,false);output.isolation={company1ProductsBefore:company1Count,company1ProductsAfter:Number((await pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1'))[0][0].total)};
 const selected: Array<{ sector: string; candidate: EnrichmentCandidate }> = [];
 const seenCodes = new Set<string>();
 const sectors = Object.keys(fixture);
 for (const selectionType of ['commercial_evidence','investigation'] as const) {
  const candidatesBySector = new Map(sectors.map(sector => [sector, (previewBySector.get(sector) ?? []).filter(candidate => candidate.selectionType === selectionType)]));
  for (let offset = 0; selected.length < 12; offset++) {
   let appended = false;
   for (const sector of sectors) {
    const candidate = candidatesBySector.get(sector)?.[offset];
    if (!candidate || seenCodes.has(candidate.code)) continue;
    seenCodes.add(candidate.code); selected.push({ sector, candidate }); appended = true;
    if (selected.length === 12) break;
   }
   if (!appended) break;
  }
  if (selected.length === 12) break;
 }
 output.enrichmentPreview = {
  candidatesAvailableBySector: previewEligibleBySector,
  selectedCount: selected.length,
  apiRequestsEstimated: selected.length,
  detailRequestsBefore: Number(previewCoverage?.detailRequests) || 0,
  confirmedCommercialEvidence: selected.filter(({ candidate }) => candidate.selectionType === 'commercial_evidence').map(({ sector, candidate }) => ({ sector, ...candidate })),
  investigationOnly: selected.filter(({ candidate }) => candidate.selectionType === 'investigation').map(({ sector, candidate }) => ({ sector, ...candidate })),
 };
 console.log(JSON.stringify(output,null,2));
}finally{
 for(const row of ids.reverse())await pool.execute('DELETE FROM companies WHERE id=? AND nombre_comercial=?',[row.id,row.name]);
 const [[temp],[company1],[listings],[items],[duplicateCodes],[duplicateItems]]=await Promise.all([
  pool.query<any[]>("SELECT COUNT(*) total FROM companies WHERE nombre_comercial LIKE 'TEMP F50 %'"),pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1'),pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) unique_codes FROM licitaciones'),pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items'),pool.query<any[]>('SELECT COUNT(*) total FROM (SELECT codigo_externo FROM licitaciones GROUP BY codigo_externo HAVING COUNT(*)>1) d'),pool.query<any[]>('SELECT COUNT(*) total FROM (SELECT codigo_externo,item_index FROM licitacion_items GROUP BY codigo_externo,item_index HAVING COUNT(*)>1) d'),
 ]);
 console.log(JSON.stringify({cleanup:{temporaryCompanies:Number(temp[0].total),company1Products:Number(company1[0].total),listings:listings[0],items:Number(items[0].total),duplicateCodes:Number(duplicateCodes[0].total),duplicateItemKeys:Number(duplicateItems[0].total)}}));await pool.end();
}
