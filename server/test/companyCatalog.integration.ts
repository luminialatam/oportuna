import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { getCompanyWorkspace, saveCompanyProfile, saveCompanyProduct, searchCompanyProducts, suggestCommercialTerms } from '../src/companyService.js';

assert.equal(process.env.GROQ_API_KEY?.trim() ?? '', '', 'Run this local integration with Groq disabled.');
const localHost = (process.env.DB_HOST ?? '127.0.0.1').trim().toLowerCase();
assert.ok(['localhost', '127.0.0.1', '::1'].includes(localHost), 'Refusing to run against a non-local database host.');
assert.notEqual((process.env.DB_NAME ?? '').trim().toLowerCase(), 'db_ac9392_licitapp', 'Refusing to use SharkASP.');
const baseContext = { userId: 27, role: 'admin' as const, platformRole: 'admin' as const };
let companyA = 0;
let companyB = 0;
let productId = 0;
let inventoryBefore: any = null;
let realCompanyBefore: any = null;

async function createCompany(label: string) {
  const [result] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [`TEMP CATÁLOGO QA ${label} ${randomUUID()}`]);
  return Number(result.insertId);
}
const withCompany = <T>(companyId: number, callback: () => Promise<T>) => runWithCompanyContext({ ...baseContext, companyId }, callback);

try {
  const [target] = await pool.query<any[]>('SELECT @@hostname server_host,DATABASE() selected_database');
  assert.ok(target[0]?.selected_database);
  assert.notEqual(String(target[0].selected_database).toLowerCase(), 'db_ac9392_licitapp', 'Refusing to use SharkASP.');
  const [[beforeInventory], [beforeRealCompany]] = await Promise.all([
    pool.query<any[]>('SELECT COUNT(*) listings,COUNT(DISTINCT codigo_externo) unique_codes,(SELECT COUNT(*) FROM licitacion_items) item_rows FROM licitaciones'),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1'),
  ]);
  inventoryBefore = beforeInventory[0];
  realCompanyBefore = beforeRealCompany[0];
  companyA = await createCompany('A');
  companyB = await createCompany('B');
  const profile = { nombreComercial: 'QA Molinos', razonSocial: null, rut: null, actividad: 'Venta de molinos coloidales para industria alimentaria.', rubros: ['maquinaria alimentaria'], regiones: ['Región Metropolitana'], sitioWeb: null, palabrasClave: ['molino coloidal'], terminosExcluidos: ['minería'], estados: [5] };
  const initialProduct = { nombre: 'Molino coloidal QA', categoria: 'Maquinaria alimentaria', descripcion: 'Equipo para molienda húmeda y emulsificación.', palabrasClave: ['molino coloidal'], sinonimos: [], terminosRelacionados: [], aplicaciones: [], exclusiones: [], tiposComerciales: ['product_supply'], activo: true };

  await withCompany(companyA, async () => {
    await saveCompanyProfile(profile);
    const created = await saveCompanyProduct(initialProduct);
    assert.equal(created?.length, 1);
    productId = created![0].id!;
    const editedInput = { ...initialProduct, descripcion: 'Equipo industrial para homogeneización de productos.', sinonimos: ['homogeneizador coloidal'] };
    const edited = await saveCompanyProduct(editedInput, productId);
    assert.equal(edited?.[0].descripcion, editedInput.descripcion);
    assert.deepEqual(edited?.[0].sinonimos, editedInput.sinonimos);
    assert.deepEqual(edited?.[0].tiposComerciales, ['product_supply']);
    const deactivated = await saveCompanyProduct({ ...editedInput, activo: false }, productId);
    assert.equal(deactivated?.[0].activo, false);
    const reactivated = await saveCompanyProduct({ ...editedInput, activo: true }, productId);
    assert.equal(reactivated?.[0].activo, true);
    assert.equal((await getCompanyWorkspace()).profile.nombreComercial, profile.nombreComercial);
  });

  const isolatedWorkspace = await withCompany(companyB, () => getCompanyWorkspace());
  const isolatedCatalog = await withCompany(companyB, () => searchCompanyProducts('Molino coloidal QA'));
  assert.equal(isolatedWorkspace.products.length, 0);
  assert.equal(isolatedCatalog.length, 0);
  const crossTenantEdit = await withCompany(companyB, () => saveCompanyProduct({ ...initialProduct, nombre: 'Intento ajeno' }, productId));
  assert.equal(crossTenantEdit, null, 'A tenant must not edit another tenant product by id.');

  const suggestions = await suggestCommercialTerms({ nombre: 'Molino coloidal', categoria: 'Maquinaria alimentaria', descripcion: 'Equipo para emulsificación.' });
  assert.equal(suggestions.provider, 'fallback');
  assert.ok(suggestions.directSynonyms.includes('molino homogenizador coloidal'));
  assert.ok(!process.env.GROQ_API_KEY?.trim());

  process.stdout.write(JSON.stringify({ result: 'PASS', mode: 'local temporary tenants; Groq disabled; no external requests', operations: ['create profile/product with commercial offer type', 'persist and read offer type on edit', 'deactivate', 'reactivate', 'cross-tenant edit rejected', 'catalog isolation', 'local suggestions'], tenantIsolation: true, inventory: { listings: Number(inventoryBefore.listings), uniqueCodes: Number(inventoryBefore.unique_codes), itemRows: Number(inventoryBefore.item_rows) }, company1CatalogRows: Number(realCompanyBefore.total) }, null, 2) + '\n');
} finally {
  for (const companyId of [companyA, companyB].filter(Boolean)) {
    await pool.execute('DELETE FROM company_products WHERE company_id=?', [companyId]).catch(() => undefined);
    await pool.execute('DELETE FROM company_search_preferences WHERE company_id=?', [companyId]).catch(() => undefined);
    await pool.execute('DELETE FROM commercial_profiles WHERE company_id=?', [companyId]).catch(() => undefined);
    await pool.execute('DELETE FROM companies WHERE id=?', [companyId]).catch(() => undefined);
  }
  const fixtureIds = [companyA, companyB].filter(Boolean);
  if (fixtureIds.length) {
    const [remaining] = await pool.query<any[]>(`SELECT COUNT(*) total FROM companies WHERE id IN (${fixtureIds.map(() => '?').join(',')})`, fixtureIds);
    assert.equal(Number(remaining[0].total), 0, 'Temporary tenant fixtures must be removed.');
  }
  const [[afterInventory], [afterRealCompany]] = await Promise.all([
    pool.query<any[]>('SELECT COUNT(*) listings,COUNT(DISTINCT codigo_externo) unique_codes,(SELECT COUNT(*) FROM licitacion_items) item_rows FROM licitaciones'),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=1'),
  ]);
  if (inventoryBefore) assert.deepEqual(afterInventory[0], inventoryBefore, 'Catalog QA must not change listings or tender items.');
  if (realCompanyBefore) assert.equal(Number(afterRealCompany[0].total), Number(realCompanyBefore.total), 'Company ID 1 catalog must remain unchanged.');
  await pool.end();
}
