import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { clearCompanyMatchCache, getCompanyMatches, saveCompanyProduct, saveCompanyProfile } from '../src/companyService.js';
import { matchesCommercialExclusion, normalizeCommercialText, scoreCatalogMatch } from '../src/commercialMatching.js';

const exclusions = ['minería', 'minero', 'minera', 'mineral', 'minerales', 'chancado', 'obras públicas', 'obras civiles', 'plaza los molinos', 'parque los molinos', 'borde costero los molinos'];
// Catálogo de referencia: nombres de equipo concretos y vocabulario comercial específico.
// Los términos de rubro («alimentos», «equipos», «procesamiento») no bastan por sí solos.
const foodProducts = [
  { nombre: 'Molinos coloidales industriales', categoria: 'Maquinaria para procesamiento de alimentos', descripcion: null, palabrasClave: ['molino coloidal', 'molino coloidal industrial', 'molienda húmeda', 'emulsificación'], sinonimos: ['molino coloidal de discos', 'molino homogenizador coloidal'], terminosRelacionados: ['homogeneizador rotor estator'], aplicaciones: ['emulsiones alimentarias'], exclusiones: exclusions, activo: true },
  { nombre: 'Molinos industriales para alimentos', categoria: 'Maquinaria alimentaria', descripcion: null, palabrasClave: ['molino de martillos', 'molino de discos', 'molino pulverizador', 'molino de granos', 'molienda de granos'], sinonimos: ['molino para harina', 'molino harinero'], terminosRelacionados: ['molienda de cereales'], aplicaciones: ['molienda de granos alimentarios'], exclusiones: exclusions, activo: true },
  { nombre: 'Prensas de aceite', categoria: 'Equipamiento de procesamiento de alimentos', descripcion: null, palabrasClave: ['prensa de aceite', 'prensa expeller', 'prensado en frío', 'extracción de aceite vegetal'], sinonimos: ['expeller', 'prensa hidráulica de aceite'], terminosRelacionados: ['prensado de semillas oleaginosas'], aplicaciones: ['producción de aceite vegetal'], exclusiones: exclusions, activo: true },
  { nombre: 'Equipamiento gastronómico', categoria: 'Equipamiento para cocinas y comedores', descripcion: null, palabrasClave: ['horno combinado', 'horno convector industrial', 'cocina industrial', 'freidora industrial', 'campana extractora', 'mesa de trabajo inoxidable', 'lavavajillas industrial', 'equipos de cocina'], sinonimos: ['menaje de cocina'], terminosRelacionados: ['central de alimentación'], aplicaciones: ['cocina institucional'], exclusiones: exclusions, activo: true },
  { nombre: 'Equipos de procesamiento de alimentos', categoria: 'Maquinaria alimentaria', descripcion: null, palabrasClave: ['mezclador industrial', 'dosificador de alimentos', 'envasadora de alimentos', 'selladora de envases', 'cinta transportadora sanitaria', 'línea de proceso alimentario'], sinonimos: ['mezcladora industrial de alimentos'], terminosRelacionados: ['planta de proceso alimentario'], aplicaciones: ['producción alimentaria'], exclusiones: [...exclusions, 'alimentación eléctrica'], activo: true },
];
// Títulos que en la revisión 3.7 aparecían como falsos positivos por términos genéricos.
const genericOnlyCodes = ['1233615-67-B226', '2495-22-LE26', '3532-3-LE26', '4371-36-LP26', '1057500-83-LE26', '539119-97-LE26', '1110404-257-LE26', '528208-47-LE26'];
const verifiableEquipmentCodes = ['5741-1-LE26'];
const controlProduct = { nombre: 'Servicios de impresión de pendones', categoria: 'Impresión gráfica', descripcion: null, palabrasClave: ['impresión de pendones'], sinonimos: ['banner publicitario'], terminosRelacionados: [], aplicaciones: ['señalética informativa'], exclusiones: [], activo: true };
const baseContext = { userId: 27, role: 'admin' as const, platformRole: 'admin' as const };
let foodCompanyId = 0;
let controlCompanyId = 0;
let toponymCompanyId = 0;
let inventoryBefore: Awaited<ReturnType<typeof inventory>> | null = null;
let report: any = null;

async function inventory() {
  const [listings, itemRows, itemListings] = await Promise.all([
    pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) unique_codes FROM licitaciones'),
    pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items'),
    pool.query<any[]>('SELECT COUNT(DISTINCT codigo_externo) total FROM licitacion_items'),
  ]);
  return { listings: Number(listings[0][0].total), uniqueCodes: Number(listings[0][0].unique_codes), indexedItemRows: Number(itemRows[0][0].total), listingsWithItems: Number(itemListings[0][0].total) };
}

async function createFixtureCompany(label: string) {
  const suffix = randomUUID();
  const [result] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [`TEMP QA MATCH ${label} ${suffix}`]);
  return Number(result.insertId);
}

async function withCompany<T>(companyId: number, callback: () => Promise<T>) {
  return runWithCompanyContext({ ...baseContext, companyId }, callback);
}

try {
  const configuredHost = (process.env.DB_HOST ?? '127.0.0.1').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(configuredHost), 'Refusing to run against a non-local database host.');
  assert.notEqual((process.env.DB_NAME ?? '').trim().toLowerCase(), 'db_ac9392_licitapp', 'Refusing to run against SharkASP staging.');
  const [targetRows] = await pool.query<any[]>('SELECT @@hostname server_host,@@port server_port,DATABASE() selected_database');
  assert.ok(targetRows[0]?.selected_database, 'MySQL did not select a database.');
  assert.notEqual(String(targetRows[0].selected_database).toLowerCase(), 'db_ac9392_licitapp', 'Refusing to run against SharkASP staging.');
  const [placeRows] = await pool.query<any[]>("SELECT codigo_externo,nombre FROM licitaciones WHERE codigo_externo IN ('2490-16-LP26','3296-20-LP26','1271-13-O126')");
  const placeNameChecks = placeRows.map((row: any) => ({ code: row.codigo_externo, excludedByPhrase: exclusions.some(phrase => matchesCommercialExclusion(String(row.nombre), phrase)) }));
  assert.ok(placeNameChecks.length >= 2 && placeNameChecks.every((item: any) => item.excludedByPhrase), 'Known Los Molinos place-name listings must match the exact phrase exclusions.');

  const before = await inventory(); inventoryBefore = before;
  const [[realCompany], [realProducts]] = await Promise.all([
    pool.query<any[]>('SELECT id FROM companies WHERE id=1'),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1 AND activo=1'),
  ]);
  assert.ok(realCompany[0], 'Expected the existing local company ID 1.');
  assert.equal(Number(realProducts[0].total), 0, 'Company ID 1 should still have an empty catalog before the fixture run.');

  const fixtureNames = foodProducts.map(product => normalizeCommercialText(product.nombre));
  assert.equal(new Set(fixtureNames).size, foodProducts.length, 'Fixture catalog contains duplicate product names.');
  foodCompanyId = await createFixtureCompany('ALIMENTOS');
  controlCompanyId = await createFixtureCompany('CONTROL');
  toponymCompanyId = await createFixtureCompany('TOPONIMOS');

  await withCompany(foodCompanyId, async () => {
    await saveCompanyProfile({ nombreComercial: 'TEMP QA maquinaria alimentaria', razonSocial: null, rut: null, actividad: 'Maquinaria para procesamiento y producción de alimentos.', rubros: ['maquinaria alimentaria'], regiones: [], sitioWeb: null, palabrasClave: ['procesamiento de alimentos'], terminosExcluidos: exclusions, estados: [5] });
    for (const product of foodProducts) await saveCompanyProduct(product);
  });
  await withCompany(controlCompanyId, async () => { await saveCompanyProduct(controlProduct); });
  await withCompany(toponymCompanyId, async () => {
    await saveCompanyProduct({ nombre: 'Horno combinado industrial', categoria: 'Equipamiento gastronómico', descripcion: null, palabrasClave: ['horno combinado'], sinonimos: [], terminosRelacionados: [], aplicaciones: [], exclusiones: [], activo: true });
    await saveCompanyProduct({ nombre: 'Molino coloidal industrial', categoria: 'Maquinaria alimentaria', descripcion: null, palabrasClave: ['molino coloidal'], sinonimos: [], terminosRelacionados: [], aplicaciones: [], exclusiones: [], activo: true });
  });

  const foodMatches = await withCompany(foodCompanyId, () => getCompanyMatches());
  const controlMatches = await withCompany(controlCompanyId, () => getCompanyMatches());
  const toponymMatches = await withCompany(toponymCompanyId, () => getCompanyMatches({ includeAllItems: true }));
  assert.equal(foodMatches.configured, true);
  assert.equal(controlMatches.configured, true);
  assert.ok(controlMatches.items.some((item: any) => item.codigo_externo === '609-29-LE26'), 'The independent pendones catalog should match the known local listing.');
  assert.ok(controlMatches.items.every((item: any) => item.productName === controlProduct.nombre), 'Control tenant must only use its own catalog.');
  const directOvenMatch = scoreCatalogMatch({ nombre: 'Horno combinado industrial' }, 'ADQUISICIÓN HORNO ELÉCTRICO COMBINADO Y ACCESORIOS', '', '');
  assert.ok(directOvenMatch && directOvenMatch.level !== 'exploratory', 'Specific oven evidence must remain a commercial match even after the historical listing closes.');
  assert.ok(!toponymMatches.items.some((item: any) => item.codigo_externo === '5741-1-LE26'), 'A closed historical oven listing must not be presented as an open opportunity.');
  assert.ok(!toponymMatches.items.some((item: any) => item.codigo_externo === '979-44-LR26'), 'Caleta Hornos is a toponym, not a tender for ovens.');
  assert.ok(!toponymMatches.items.some((item: any) => ['3296-20-LP26','1271-13-O126'].includes(item.codigo_externo)), 'Los Molinos place names must not match mill equipment without user-specific exclusions.');
  assert.ok(foodMatches.items.every((item: any) => foodProducts.some(product => product.nombre === item.productName)), 'Food tenant results must be attributed to its own fixture products.');
  assert.ok(!foodMatches.items.some((item: any) => item.codigo_externo === '609-29-LE26'), 'Food tenant must not inherit the control tenant match.');
  assert.ok(!foodMatches.items.some((item: any) => /min(er[ií]a|eral)|chancado/i.test(`${item.nombre} ${item.matchReasons.join(' ')}`)), 'Excluded mining evidence must not reach the top Match results.');
  assert.ok(foodMatches.items.every((item: any) => ['indexed', 'limited'].includes(item.coverageStatus)), 'Every Match result reports whether indexed parts are available.');

  const foodCodes = foodMatches.items.map((item: any) => item.codigo_externo);
  assert.ok(!foodCodes.some(code => genericOnlyCodes.includes(code)), 'Listings that only mention generic food or equipment words must not reach the machinery Match.');
  const [referenceOpen] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones WHERE codigo_estado=5 AND (fecha_cierre IS NULL OR fecha_cierre>=UTC_TIMESTAMP()) AND codigo_externo IN (?)', [verifiableEquipmentCodes]);
  for (const row of referenceOpen) assert.ok(foodCodes.includes(String(row.codigo_externo)), `An open listing with verifiable equipment evidence must be offered: ${row.codigo_externo}`);
  const oven = foodMatches.items.find((item: any) => item.codigo_externo === '5741-1-LE26');
  if (oven) assert.equal(oven.productName, 'Equipamiento gastronómico', 'Oven evidence must be attributed to the gastronomic equipment product.');
  assert.ok(!foodMatches.items.some((item: any) => item.codigo_externo === '1410-25-LE26'), 'A service of institutional food without a specified machine is ambiguous, not equipment evidence.');
  assert.ok(foodMatches.items.every((item: any) => item.level !== 'high' || !genericOnlyCodes.includes(item.codigo_externo)), 'Generic-only listings must never be ranked high.');

  report = {
    mode: 'local temporary tenant fixtures; CRUD service and Match service; no Groq or Mercado Público calls',
    mysql: { hostname: targetRows[0].server_host, database: targetRows[0].selected_database },
    inventory: { before, after: null },
    fixtureCatalog: { foodProducts: foodProducts.map(product => product.nombre), distinctNames: fixtureNames.length },
    falsePositiveChecks: { losMolinosPlaceTitles: placeNameChecks, realMillTitleRemainsUnexcluded: !matchesCommercialExclusion('Adquisición de molinos para harina', 'parque los molinos'), genericOnlyCodesExcluded: genericOnlyCodes.filter(code => !foodCodes.includes(code)), referenceOpenListings: referenceOpen.map((row: any) => row.codigo_externo) },
    foodMatch: { total: foodMatches.total, high: foodMatches.high, medium: foodMatches.medium, exploratory: foodMatches.exploratory, candidatesEvaluated: foodMatches.candidatesEvaluated, coverage: foodMatches.coverage, items: foodMatches.items },
    controlMatch: { total: controlMatches.total, candidatesEvaluated: controlMatches.candidatesEvaluated, items: controlMatches.items },
    toponymSafeguard: { retainedRealOven: toponymMatches.items.some((item: any) => item.codigo_externo === '5741-1-LE26'), excludedFalsePositives: ['979-44-LR26','3296-20-LP26','1271-13-O126'].filter(code => !toponymMatches.items.some((item: any) => item.codigo_externo === code)) },
    tenantIsolation: true,
  };
} finally {
  for (const companyId of [foodCompanyId, controlCompanyId, toponymCompanyId].filter(Boolean)) {
    await pool.execute('DELETE FROM company_products WHERE company_id=?', [companyId]).catch(() => undefined);
    await pool.execute('DELETE FROM company_search_preferences WHERE company_id=?', [companyId]).catch(() => undefined);
    await pool.execute('DELETE FROM commercial_profiles WHERE company_id=?', [companyId]).catch(() => undefined);
    await pool.execute('DELETE FROM companies WHERE id=?', [companyId]).catch(() => undefined);
  }
  const fixtureIds = [foodCompanyId, controlCompanyId, toponymCompanyId].filter(Boolean);
  if (fixtureIds.length) {
    const [remainingFixtures] = await pool.query<any[]>(`SELECT COUNT(*) total FROM companies WHERE id IN (${fixtureIds.map(() => '?').join(',')})`, fixtureIds);
    assert.equal(Number(remainingFixtures[0].total), 0, 'Temporary tenant fixtures must be fully removed.');
  }
  clearCompanyMatchCache();
  const after = await inventory();
  const [[realProductsAfter]] = await Promise.all([pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1 AND activo=1')]);
  assert.equal(Number(realProductsAfter[0].total), 0, 'The real company ID 1 catalog must remain unchanged.');
  if (inventoryBefore) assert.deepEqual(after, inventoryBefore, 'Historical listings and indexed parts must remain unchanged.');
  if (report) { report.inventory.after = after; process.stdout.write(JSON.stringify(report, null, 2) + '\n'); }
  await pool.end();
}
