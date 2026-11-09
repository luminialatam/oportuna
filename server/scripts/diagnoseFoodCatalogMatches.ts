import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches, saveCompanyProduct, saveCompanyProfile } from '../src/companyService.js';
import {
  commercialTerms,
  hasCommercialTerm,
  normalizeCommercialText,
  scoreCatalogMatch,
  type CatalogMatchInput,
} from '../src/commercialMatching.js';

/**
 * Diagnóstico local del Match para un catálogo de maquinaria alimentaria.
 *
 * Crea una empresa temporal, carga el catálogo de prueba, ejecuta el Match y
 * describe cada coincidencia (producto, término responsable y clasificación).
 * No usa Groq ni Mercado Público, no toca la empresa ID 1 y elimina todo al
 * terminar. Uso: npm run diagnose:food-matches
 */

const exclusions = ['minería', 'minero', 'minera', 'mineral', 'minerales', 'chancado', 'obras públicas', 'obras civiles', 'plaza los molinos', 'parque los molinos', 'borde costero los molinos'];

const foodProducts: Array<CatalogMatchInput & { descripcion: string | null; exclusiones: string[]; activo: boolean }> = [
  { nombre: 'Molinos coloidales industriales', categoria: 'Maquinaria para procesamiento de alimentos', descripcion: null, palabrasClave: ['molino coloidal', 'molino coloidal industrial', 'molienda húmeda', 'emulsificación'], sinonimos: ['molino coloidal de discos', 'molino homogenizador coloidal'], terminosRelacionados: ['homogeneizador rotor estator'], aplicaciones: ['emulsiones alimentarias'], exclusiones: exclusions, activo: true },
  { nombre: 'Molinos industriales para alimentos', categoria: 'Maquinaria alimentaria', descripcion: null, palabrasClave: ['molino de martillos', 'molino de discos', 'molino pulverizador', 'molino de granos', 'molienda de granos'], sinonimos: ['molino para harina', 'molino harinero'], terminosRelacionados: ['molienda de cereales'], aplicaciones: ['molienda de granos alimentarios'], exclusiones: exclusions, activo: true },
  { nombre: 'Prensas de aceite', categoria: 'Equipamiento de procesamiento de alimentos', descripcion: null, palabrasClave: ['prensa de aceite', 'prensa expeller', 'prensado en frío', 'extracción de aceite vegetal'], sinonimos: ['expeller', 'prensa hidráulica de aceite'], terminosRelacionados: ['prensado de semillas oleaginosas'], aplicaciones: ['producción de aceite vegetal'], exclusiones: exclusions, activo: true },
  { nombre: 'Equipamiento gastronómico', categoria: 'Equipamiento para cocinas y comedores', descripcion: null, palabrasClave: ['horno combinado', 'horno convector industrial', 'cocina industrial', 'freidora industrial', 'campana extractora', 'mesa de trabajo inoxidable', 'lavavajillas industrial', 'equipos de cocina'], sinonimos: ['menaje de cocina'], terminosRelacionados: ['central de alimentación'], aplicaciones: ['cocina institucional'], exclusiones: exclusions, activo: true },
  { nombre: 'Equipos de procesamiento de alimentos', categoria: 'Maquinaria alimentaria', descripcion: null, palabrasClave: ['mezclador industrial', 'dosificador de alimentos', 'envasadora de alimentos', 'selladora de envases', 'cinta transportadora sanitaria', 'línea de proceso alimentario'], sinonimos: ['mezcladora industrial de alimentos'], terminosRelacionados: ['planta de proceso alimentario'], aplicaciones: ['producción alimentaria'], exclusiones: [...exclusions, 'alimentación eléctrica'], activo: true },
];

const baseContext = { userId: 27, role: 'admin' as const, platformRole: 'admin' as const };

const machinerySignals = /molino|molienda|coloidal|prensa|aceite|harina|cereal|gastronom|cocina|comida|aliment|panific|amasa|mesa|horno|freidora|lavavajillas|campana extractora|peladora|deshidratador|envasad|procesamiento|maquinaria|equipo/i;
const specificEquipmentSignals = /molino|molienda|coloidal|prensa|horno|freidora|lavavajillas|campana extractora|peladora|deshidratador|envasadora|selladora|mezclador|dosificador|cinta transportadora/i;
const genericSignals = /\b(alimentos?|servicios?|equipos?|procesamiento|suministros?|insumos?)\b/i;

function phraseEvidence(product: CatalogMatchInput, title: string, description: string, items: string) {
  const texts: Array<[string, string]> = [['título', title], ['descripción', description], ['partidas', items]];
  const sources = new Map<string, string[]>();
  const add = (source: string, phrase: string) => {
    const current = sources.get(source) ?? [];
    if (!current.includes(phrase)) current.push(phrase);
    sources.set(source, current);
  };
  const hitValue = (value: string) => {
    const valueTerms = [...new Set(commercialTerms(value))];
    if (!valueTerms.length) return false;
    return texts.some(([, text]) => valueTerms.length > 1 ? hasCommercialTerm(text, value) : hasCommercialTerm(text, valueTerms[0]));
  };
  const groups: Array<[string, string[]]> = [
    ['nombre', [product.nombre]],
    ['categoría', product.categoria ? [product.categoria] : []],
    ['palabras clave', product.palabrasClave ?? []],
    ['sinónimos', product.sinonimos ?? []],
    ['relacionados', product.terminosRelacionados ?? []],
    ['aplicaciones', product.aplicaciones ?? []],
  ];
  const nameTerms = [...new Set(commercialTerms(product.nombre, true))];
  for (const [source, text] of texts) {
    for (const term of nameTerms) if (hasCommercialTerm(text, term)) add(source, `nombre:${term}`);
    for (const [group, values] of groups.slice(1)) {
      for (const value of values) if (hitValue(value)) add(source, `${group}:${value}`);
    }
  }
  return Object.fromEntries(sources);
}

function classify(title: string, description: string, items: string, level: string) {
  const text = `${title} ${description} ${items}`;
  const machinery = machinerySignals.test(text);
  if (machinery && specificEquipmentSignals.test(text)) return 'pertinente';
  if (level === 'high' && machinery) return 'pertinente';
  if (!machinery) return 'irrelevante';
  const wordCount = normalizeCommercialText(title).split(' ').filter(Boolean).length;
  if (genericSignals.test(title) && wordCount <= 6) return 'dudoso';
  return 'dudoso';
}

let fixtureCompanyId = 0;

try {
  const configuredHost = (process.env.DB_HOST ?? '127.0.0.1').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(configuredHost), 'Refusing to run against a non-local database host.');
  assert.notEqual((process.env.DB_NAME ?? '').trim().toLowerCase(), 'db_ac9392_licitapp', 'Refusing to run against SharkASP staging.');
  const [targetRows] = await pool.query<any[]>('SELECT @@hostname server_host,DATABASE() selected_database');
  assert.ok(targetRows[0]?.selected_database, 'MySQL did not select a database.');

  const [[realCompany], [realProducts]] = await Promise.all([
    pool.query<any[]>('SELECT id FROM companies WHERE id=1'),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1 AND activo=1'),
  ]);
  assert.ok(realCompany[0], 'Expected the existing local company ID 1.');
  assert.equal(Number(realProducts[0].total), 0, 'Company ID 1 catalog must stay empty.');

  const [inventoryBefore] = await pool.query<any[]>('SELECT (SELECT COUNT(*) FROM licitaciones) listings,(SELECT COUNT(*) FROM licitacion_items) items');
  const suffix = randomUUID();
  const [insert] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [`TEMP QA DIAG FOOD ${suffix}`]);
  fixtureCompanyId = Number(insert.insertId);

  await runWithCompanyContext({ ...baseContext, companyId: fixtureCompanyId }, async () => {
    await saveCompanyProfile({ nombreComercial: 'TEMP QA maquinaria alimentaria', razonSocial: null, rut: null, actividad: 'Maquinaria para procesamiento y producción de alimentos.', rubros: ['maquinaria alimentaria'], regiones: [], sitioWeb: null, palabrasClave: ['procesamiento de alimentos'], terminosExcluidos: exclusions, estados: [5] });
    for (const product of foodProducts) await saveCompanyProduct(product);
  });

  const matches = await runWithCompanyContext({ ...baseContext, companyId: fixtureCompanyId }, () => getCompanyMatches({ includeAllItems: true }));
  const codes = matches.items.map((item: any) => item.codigo_externo);

  const rows = new Map<string, any>();
  if (codes.length) {
    const [detail] = await pool.query<any[]>(`SELECT l.codigo_externo,l.nombre,l.organismo,l.fecha_cierre,l.monto_estimado,l.moneda,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(l.payload_json,'$.Descripcion')),'') official_description,
        COALESCE((SELECT GROUP_CONCAT(DISTINCT CONCAT_WS(' ',li.nombre,li.descripcion,li.categoria) SEPARATOR ' · ') FROM licitacion_items li WHERE li.codigo_externo=l.codigo_externo),'') item_text
      FROM licitaciones l WHERE l.codigo_externo IN (${codes.map(() => '?').join(',')})`, codes);
    for (const row of detail) rows.set(row.codigo_externo, row);
  }

  const candidates = matches.items.map((item: any) => {
    const row = rows.get(item.codigo_externo) ?? {};
    const title = String(row.nombre ?? item.nombre ?? '');
    const description = String(row.official_description ?? '');
    const items = String(row.item_text ?? '');
    const product = foodProducts.find(candidate => candidate.nombre === item.productName)!;
    const score = scoreCatalogMatch(product, title, description, items);
    return {
      codigo: item.codigo_externo,
      titulo: title,
      organismo: row.organismo ?? item.organismo,
      cierre: row.fecha_cierre ?? item.fecha_cierre,
      monto: row.monto_estimado ?? item.monto_estimado,
      moneda: row.moneda ?? item.moneda,
      descripcion: description.slice(0, 260),
      partidas: items.slice(0, 260),
      producto: item.productName,
      nivel: item.level,
      puntaje: item.score,
      terminosNombre: score?.nameTerms ?? [],
      evidenciaPorFuente: phraseEvidence(product, title, description, items),
      fuentes: item.evidenceSources,
      motivos: item.matchReasons,
      clasificacionSugerida: classify(title, description, items, item.level),
    };
  });

  const summary = {
    modo: 'diagnóstico local con empresa temporal; sin Groq ni Mercado Público',
    mysql: { hostname: targetRows[0].server_host, database: targetRows[0].selected_database },
    catalogo: foodProducts.map(product => product.nombre),
    inventarioAntes: inventoryBefore[0],
    cobertura: matches.coverage,
    candidatosEvaluados: matches.candidatesEvaluated,
    totales: { total: matches.total, high: matches.high, medium: matches.medium, exploratory: matches.exploratory },
    clasificacion: candidates.reduce<Record<string, number>>((acc, item) => { acc[item.clasificacionSugerida] = (acc[item.clasificacionSugerida] ?? 0) + 1; return acc; }, {}),
    candidatas: candidates,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} finally {
  if (fixtureCompanyId) {
    await pool.execute('DELETE FROM company_products WHERE company_id=?', [fixtureCompanyId]).catch(() => undefined);
    await pool.execute('DELETE FROM company_search_preferences WHERE company_id=?', [fixtureCompanyId]).catch(() => undefined);
    await pool.execute('DELETE FROM commercial_profiles WHERE company_id=?', [fixtureCompanyId]).catch(() => undefined);
    await pool.execute('DELETE FROM companies WHERE id=?', [fixtureCompanyId]).catch(() => undefined);
  }
  clearCompanyMatchCache();
  await pool.end();
}
