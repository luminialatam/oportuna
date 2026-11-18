import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import pool from '../src/db.js';
import { createSession, createUser, login, revokeSession } from '../src/authService.js';

const base = process.env.QA_TEST_BASE ?? 'http://127.0.0.1:5180';
const suffix = randomUUID();
const email = `qa-company-profile-${suffix}@invalid.example`;
const brand = `QA TEMP Profile ${suffix}`;
const password = 'Temporary-QA-Password-2026!';
let companyId = 0;
let conflictCompanyId = 0;
let userId = 0;
let sessionRaw = '';
let conflictSessionRaw = '';
let browser: Browser | undefined;
const errors: string[] = [];
let profileSaveRequests = 0;
let expectedInvalidRutResponse = false;
let searchInterestBefore: Array<{ codigo_externo: string; search_count: number; first_seen_at: Date | string; last_seen_at: Date | string }> | null = null;
const fieldValues = {
  'Nombre Comercial': brand,
  'Razón Social': `QA Perfil SpA ${suffix}`,
  'Email de Contacto': '',
  Teléfono: '+56 9 5555 0101',
  'Sitio Web': 'https://qa.invalid.example',
  Dirección: `Calle QA ${suffix}`,
  Comuna: 'Santiago',
  'Región Principal': 'Metropolitana de Santiago',
  'Descripción comercial y actividades': `Descripción temporal QA ${suffix}`,
  'Rubros comerciales (uno por línea)': `Rubro QA ${suffix}\nServicios de impresión\nServicios temporales`,
  'Regiones donde opera (una por línea)': 'Metropolitana de Santiago\nValparaíso',
  'Palabras clave comerciales (una por línea)': `Impresión QA ${suffix}\nPendones`,
  'Términos excluidos (uno por línea)': 'Arriendo\nUsado',
};

function makeRut(body: number) {
  let sum = 0, factor = 2;
  for (let i = String(body).length - 1; i >= 0; i--) {
    sum += Number(String(body)[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  return `${body}-${remainder === 11 ? '0' : remainder === 10 ? 'K' : remainder}`;
}

async function noHorizontalOverflow(page: import('playwright').Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(100);
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *')).map(element => ({ element, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.right > innerWidth + 1).sort((a, b) => b.rect.right - a.rect.right).slice(0, 5).map(({ element, rect }) => ({ tag: element.tagName, id: element.id, className: String(element.className).slice(0, 100), text: element.innerText?.slice(0, 60), right: Math.round(rect.right), left: Math.round(rect.left) })),
  }));
  assert.ok(sizes.document <= sizes.viewport + 1, `desbordamiento horizontal ${width}x${height}: ${sizes.document}/${sizes.viewport}; ${JSON.stringify(sizes.offenders)}`);
}

try {
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(new URL(base).hostname), 'QA only permits a local browser target');
  assert.ok(process.env.DB_SOCKET?.trim() || ['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST?.trim() || '127.0.0.1'), 'QA only permits a local database');
  const [[totals], [items]] = await Promise.all([
    pool.query<any[]>('SELECT COUNT(*) total FROM licitaciones'),
    pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items'),
  ]);
  const initial = { listings: Number(totals[0].total), items: Number(items[0].total) };
  const body = 30_000_000 + Math.floor(Math.random() * 60_000_000);
  const rut = makeRut(body);
  const [company] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [brand]);
  companyId = Number(company.insertId);
  userId = await createUser(email, password);
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')", [userId, companyId]);
  const created = await createSession(userId, companyId);
  sessionRaw = created.raw;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await context.addCookies([
    { name: 'oportuna.sid', value: created.raw, url: base, httpOnly: true, sameSite: 'Lax' },
    { name: 'oportuna.csrf', value: created.csrf, url: base, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/company/profile' && request.method() === 'PUT') profileSaveRequests++;
  });
  page.on('dialog', dialog => { void dialog.accept(); });
  page.on('console', message => {
    if (message.type() === 'error' && !(expectedInvalidRutResponse && message.text().includes('status of 400 (Bad Request)'))) errors.push(`console: ${message.text()}`);
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400 && path.startsWith('/api/') && !(expectedInvalidRutResponse && path === '/api/company/profile' && response.status() === 400)) errors.push(`api ${response.status()} ${path}`);
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Mi empresa' }).click();
  const rutInput = page.getByLabel('RUT Empresa');
  await rutInput.waitFor({ state: 'visible' });
  assert.equal(await rutInput.isDisabled(), false);

  // Character-by-character editing, correction and a pasted value are all accepted.
  await rutInput.fill('');
  await rutInput.pressSequentially('76842109k');
  assert.equal(await rutInput.inputValue(), '76842109k');
  await rutInput.press('Backspace');
  assert.equal(await rutInput.inputValue(), '76842109');
  await rutInput.fill('');
  await page.evaluate(async value => navigator.clipboard.writeText(value), rut);
  await rutInput.click();
  await page.keyboard.press('ControlOrMeta+V');
  assert.equal(await rutInput.inputValue(), rut);
  await rutInput.blur();

  const rubros = page.getByLabel('Rubros comerciales (uno por línea)', { exact: true });
  await rubros.fill('Primera línea');
  await rubros.press('Enter');
  assert.equal(await rubros.inputValue(), 'Primera línea\n', 'Enter adds a line without submitting the profile form');
  await rubros.type('Línea intermedia');
  await rubros.press('Shift+Enter');
  assert.equal(await rubros.inputValue(), 'Primera línea\nLínea intermedia\n', 'Shift+Enter adds another line');
  await page.waitForTimeout(100);
  assert.equal(profileSaveRequests, 0, 'Enter in the profile textarea does not submit the form');
  await rubros.type('Línea que se borrará');
  const middleStart = 'Primera línea\n'.length;
  await rubros.evaluate((element, start) => (element as HTMLTextAreaElement).setSelectionRange(start, start + 'Línea intermedia'.length), middleStart);
  await rubros.type('Línea intermedia editada');
  const lastLineStart = 'Primera línea\nLínea intermedia editada\n'.length;
  await rubros.evaluate((element, start) => (element as HTMLTextAreaElement).setSelectionRange(start, (element as HTMLTextAreaElement).value.length), lastLineStart);
  await rubros.press('Backspace');
  await rubros.press('Backspace');
  assert.equal(await rubros.inputValue(), 'Primera línea\nLínea intermedia editada', 'Enter/Shift+Enter, editing and deleting a line preserve the textarea draft');
  fieldValues['Rubros comerciales (uno por línea)'] = await rubros.inputValue();
  for (const [label, value] of Object.entries(fieldValues)) await page.getByLabel(label, { exact: label !== 'Nombre Comercial' }).fill(value);
  const invalid = '76.842.109-K';
  await rutInput.fill(invalid);
  expectedInvalidRutResponse = true;
  await page.getByRole('button', { name: 'Guardar Perfil' }).click();
  await page.getByText('Ingresa un RUT válido.', { exact: true }).waitFor({ timeout: 5000 });
  expectedInvalidRutResponse = false;

  await rutInput.fill(rut);
  await page.getByRole('button', { name: 'Guardar Perfil' }).click();
  await page.getByText('Perfil de empresa actualizado con éxito.', { exact: true }).waitFor({ timeout: 10000 });
  const [conflictCompany] = await pool.execute<any>('INSERT INTO companies (nombre_comercial) VALUES (?)', [`${brand} conflicto`]);
  conflictCompanyId = Number(conflictCompany.insertId);
  await pool.execute("INSERT INTO company_memberships (user_id,company_id,role,status) VALUES (?,?,'admin','active')", [userId, conflictCompanyId]);
  const conflictSession = await createSession(userId, conflictCompanyId);
  conflictSessionRaw = conflictSession.raw;
  const duplicateResponse = await fetch('http://127.0.0.1:4000/api/company/profile', {
    method: 'PUT',
    headers: {
      Origin: new URL(base).origin,
      Cookie: `oportuna.sid=${encodeURIComponent(conflictSession.raw)}; oportuna.csrf=${encodeURIComponent(conflictSession.csrf)}`,
      'X-CSRF-Token': conflictSession.csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nombreComercial: `${brand} conflicto`, razonSocial: null, rut, emailContacto: null, telefono: null, direccion: null, comuna: null, regionPrincipal: null, descripcionComercial: null, actividad: null, rubros: [], regiones: [], sitioWeb: null, palabrasClave: [], terminosExcluidos: [], estados: [5] }),
  });
  assert.equal(duplicateResponse.status, 409, 'an existing company RUT cannot be assigned twice');
  assert.match((await duplicateResponse.json()).error, /ya está registrado/i);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Mi empresa' }).click();
  assert.equal(await page.getByLabel('RUT Empresa').inputValue(), rut.replace(/^(\d+)-(\w)$/, (_m, digits: string, verifier: string) => `${Number(digits).toLocaleString('es-CL')}-${verifier}`));
  for (const [label, value] of Object.entries(fieldValues)) assert.equal(await page.getByLabel(label, { exact: label !== 'Nombre Comercial' }).inputValue(), value, `${label} persisted after reload`);
  await page.screenshot({ path: '/tmp/oportuna-company-profile-desktop.png', fullPage: true });

  await noHorizontalOverflow(page, 390, 844);
  await noHorizontalOverflow(page, 375, 667);
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  const mobileCompanySelector = page.locator('aside select[aria-label="Empresa activa"]');
  await mobileCompanySelector.waitFor({ state: 'visible' });
  const switchToConflict = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/company' && response.request().method() === 'POST');
  await mobileCompanySelector.selectOption(String(conflictCompanyId));
  assert.equal((await switchToConflict).status(), 200, 'mobile company selector changes to an authorized membership');
  assert.equal((await page.evaluate(async () => (await (await fetch('/api/auth/session')).json()).activeCompanyId)), conflictCompanyId);
  const switchBack = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/company' && response.request().method() === 'POST');
  await mobileCompanySelector.selectOption(String(companyId));
  assert.equal((await switchBack).status(), 200, 'mobile company selector restores the original temporary membership');
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('button', { name: 'Mi empresa' }).click();
  assert.equal(new URL(page.url()).pathname, '/empresa');
  await page.screenshot({ path: '/tmp/oportuna-company-profile-mobile.png', fullPage: true });
  assert.equal(await rutInput.isDisabled(), false);
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByRole('button', { name: /Catálogo/ }).click();
  await page.getByRole('button', { name: 'Agregar Producto / Servicio' }).click();
  const productName = `QA Producto ${suffix.slice(0, 8)}`;
  await page.getByPlaceholder('Ej. Ventilador mecánico de transporte').fill(productName);
  await page.getByPlaceholder('Ej. Equipamiento Médico y Hospitalario').fill('QA temporal');
  await page.getByRole('button', { name: 'Guardar en Catálogo' }).click();
  await page.getByRole('heading', { name: productName, level: 4 }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Pausar Match' }).click();
  await page.getByRole('button', { name: 'Activar Match' }).waitFor({ timeout: 5000 });
  await page.getByTitle('Editar producto').click();
  await page.getByPlaceholder('Ej. Ventilador mecánico de transporte').fill(`${productName} Editado`);
  await page.getByRole('button', { name: 'Actualizar Producto' }).click();
  await page.getByRole('heading', { name: `${productName} Editado`, level: 4 }).waitFor({ timeout: 5000 });
  await page.getByTitle('Eliminar producto').click();
  await page.getByText('Producto eliminado del catálogo.', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByRole('heading', { name: `${productName} Editado`, level: 4 }).count(), 0);
  const [catalogRowsAfterDelete] = await pool.query<any[]>('SELECT id FROM company_products WHERE company_id=? AND nombre LIKE ?', [companyId, `${productName}%`]);
  assert.equal(catalogRowsAfterDelete.length, 0, 'temporary catalog deletion reached the database');

  const [[listing]] = await pool.query<any[]>('SELECT codigo_externo FROM licitaciones ORDER BY fecha_cierre IS NULL, fecha_cierre ASC LIMIT 1');
  const routePaths = ['/', '/buscar', `/oportunidades/${encodeURIComponent(String(listing.codigo_externo))}`, '/seguimiento', '/alertas', '/inteligencia-mercado', '/empresa', '/equipo', '/configuracion', '/perfil', '/seguridad', '/centro-de-pruebas'];
  const routeInventory: Array<{ route: string; controls: number; overflow: boolean; offenders?: unknown[] }> = [];
  for (const route of routePaths) {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(350);
    assert.equal(new URL(page.url()).pathname, route, `route resolves: ${route}`);
    const desktop = await page.evaluate(() => ({ controls: document.querySelectorAll('button,a,input,select,textarea,[role="button"],[role="tab"],[role="switch"]').length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
    assert.equal(desktop.overflow, false, `desktop overflow on ${route}: ${JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *')).map(element => ({ element, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.right > innerWidth + 1).sort((a, b) => b.rect.right - a.rect.right).slice(0, 5).map(({ element, rect }) => ({ tag: element.tagName, id: element.id, className: String(element.className).slice(0, 100), right: Math.round(rect.right), left: Math.round(rect.left) }))))}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, offenders: Array.from(document.querySelectorAll<HTMLElement>('body *')).map(element => ({ element, rect: element.getBoundingClientRect() })).filter(({ rect }) => rect.right > innerWidth + 1).sort((a, b) => b.rect.right - a.rect.right).slice(0, 3).map(({ element, rect }) => ({ tag: element.tagName, className: String(element.className).slice(0, 80), right: Math.round(rect.right), left: Math.round(rect.left) })) }));
    routeInventory.push({ route, controls: desktop.controls, overflow: mobile.overflow, ...(mobile.overflow ? { offenders: mobile.offenders } : {}) });
  }
  assert.ok(routeInventory.every(item => !item.overflow), `mobile overflow: ${JSON.stringify(routeInventory.filter(item => item.overflow))}`);
  await page.goto(`${base}/inteligencia-mercado`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Ver todos', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/buscar', 'market panel action opens search');

  // Exercise the real search UI using the local fallback only; restore its global analytics rows afterward.
  const [interestRows] = await pool.query<any[]>('SELECT codigo_externo,search_count,first_seen_at,last_seen_at FROM licitacion_search_interest');
  searchInterestBefore = interestRows;
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`${base}/buscar`, { waitUntil: 'domcontentloaded' });
  const searchStatus = await page.evaluate(async () => (await fetch('/api/buscador/status')).json());
  assert.equal(searchStatus.groqConfigured, false, 'local search fallback must be active so this test cannot call Groq');
  await page.getByPlaceholder(/Describe qué ofrece tu empresa/).fill('pendones');
  const searchResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/buscador/search' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const searchResponse = await searchResponsePromise;
  assert.equal(searchResponse.status(), 200, 'real search UI request succeeds against local API');
  const searchData = await searchResponse.json();
  assert.ok(Array.isArray(searchData.items) && typeof searchData.total === 'number');
  if (searchData.items.length) {
    await page.getByRole('button', { name: 'Tarjetas', exact: true }).click();
    assert.equal(await page.locator('table').count(), 0, 'search view switches to cards');
    await page.getByRole('button', { name: 'Tabla', exact: true }).click();
    assert.ok(await page.locator('table').count(), 'search view switches back to table');
    await page.locator('select').filter({ has: page.locator('option[value="5"]') }).first().selectOption('5');
    const filteredPromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/buscador/search' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const filteredResponse = await filteredPromise;
    assert.equal(filteredResponse.status(), 200);
    assert.deepEqual(filteredResponse.request().postDataJSON().states, [5], 'Estado filter reaches the API');
    await page.getByRole('button', { name: 'Guardar', exact: true }).first().click();
    await page.getByText(/guardada en Seguimiento/).waitFor({ timeout: 5000 });
    const trackedCode = String(searchData.items[0].codigo_externo);
    const [trackedRows] = await pool.query<any[]>('SELECT codigo_externo FROM company_opportunity_tracking WHERE company_id=? AND codigo_externo=?', [companyId, trackedCode]);
    assert.equal(trackedRows.length, 1, 'search result action persists in the temporary company tracking list');
    await page.goto(`${base}/seguimiento`, { waitUntil: 'domcontentloaded' });
    await page.getByText(trackedCode, { exact: true }).waitFor({ timeout: 5000 });
  } else {
    console.log('INFO: local search returned no results; result action not exercised.');
  }

  await page.goto(`${base}/perfil`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Nombre', { exact: true }).fill(`Perfil QA ${suffix}`);
  await page.getByLabel('Apellido', { exact: true }).fill('Temporal');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('status').getByText('Perfil actualizado.').waitFor({ timeout: 5000 });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Nombre', { exact: true }).inputValue(), `Perfil QA ${suffix}`);
  assert.equal(await page.getByLabel('Apellido', { exact: true }).inputValue(), 'Temporal');

  const nextPassword = `QA-Changed-${suffix}-Password!`;
  await page.goto(`${base}/seguridad`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Contraseña actual').fill(password);
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(nextPassword);
  await page.getByLabel('Confirmar nueva contraseña').fill(`${nextPassword}mismatch`);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await page.getByRole('alert').getByText('La confirmación no coincide con la nueva contraseña.').waitFor({ timeout: 3000 });
  await page.getByLabel('Confirmar nueva contraseña').fill(nextPassword);
  await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await page.getByRole('status').getByText(/Contraseña actualizada/).waitFor({ timeout: 10000 });
  assert.equal(await login(email, nextPassword), userId, 'new password is accepted by the existing authentication service');
  assert.deepEqual(errors, [], `unexpected browser/API errors: ${JSON.stringify(errors)}`);
  assert.deepEqual(errors, [], `unexpected browser/API errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ pass: 'Mi empresa: edición multilínea con Enter/Shift+Enter, corrección/borrado de líneas y persistencia sin duplicados; escritura, pegado, validación y CRUD real en Catálogo; Perfil: edición y persistencia; Seguridad: validación y cambio real de contraseña; Buscar: consulta, vistas, filtro y guardado real en Seguimiento', routeInventory }));
  await context.close();
  const [[finalTotals], [finalItems]] = await Promise.all([
    pool.query<any[]>('SELECT COUNT(*) total FROM licitaciones'),
    pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items'),
  ]);
  assert.equal(Number(finalTotals[0].total), initial.listings);
  assert.equal(Number(finalItems[0].total), initial.items);
} catch (error) {
  console.error('FAIL Playwright Mi empresa:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); } catch {}
  try {
    if (searchInterestBefore) {
      const beforeByCode = new Map(searchInterestBefore.map(row => [row.codigo_externo, row]));
      const [currentRows] = await pool.query<any[]>('SELECT codigo_externo FROM licitacion_search_interest');
      for (const row of currentRows) {
        const before = beforeByCode.get(String(row.codigo_externo));
        if (!before) await pool.execute('DELETE FROM licitacion_search_interest WHERE codigo_externo=?', [row.codigo_externo]);
      }
      for (const row of searchInterestBefore) await pool.execute('UPDATE licitacion_search_interest SET search_count=?,first_seen_at=?,last_seen_at=? WHERE codigo_externo=?', [row.search_count, row.first_seen_at, row.last_seen_at, row.codigo_externo]);
    }
    if (conflictSessionRaw) await revokeSession(conflictSessionRaw);
    if (sessionRaw) await revokeSession(sessionRaw);
    if (conflictCompanyId) await pool.execute('DELETE FROM companies WHERE id=?', [conflictCompanyId]);
    if (companyId) await pool.execute('DELETE FROM companies WHERE id=?', [companyId]);
    if (userId) await pool.execute('DELETE FROM app_users WHERE id=?', [userId]);
    const [[companies]] = await Promise.all([pool.query<any[]>('SELECT COUNT(*) total FROM companies WHERE nombre_comercial IN (?,?)', [brand, `${brand} conflicto`])]);
    assert.equal(Number(companies[0].total), 0, 'temporary company cleanup');
    console.log('CLEANUP PASS: empresa y usuario temporales eliminados.');
  } catch (error) {
    console.error('CLEANUP FAIL:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await pool.end();
}
