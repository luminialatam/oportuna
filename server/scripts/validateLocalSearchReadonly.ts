import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { getCompanyMatches } from '../src/companyService.js';
import { searchListings } from '../src/smartSearch.js';

const queries = ['pendones', 'molinos', 'mantequilla de maní', 'equipamiento gastronómico', 'equipos de laboratorio', 'mantención'];

async function inventory() {
  const [countResult, itemResult, enrichedResult] = await Promise.all([
    pool.query<any[]>('SELECT COUNT(*) total,COUNT(DISTINCT codigo_externo) unique_codes FROM licitaciones'),
    pool.query<any[]>('SELECT COUNT(*) total FROM licitacion_items'),
    pool.query<any[]>('SELECT COUNT(DISTINCT codigo_externo) total FROM licitacion_items'),
  ]);
  return { listings: Number(countResult[0][0].total), uniqueCodes: Number(countResult[0][0].unique_codes), indexedItems: Number(itemResult[0][0].total), listingsWithItems: Number(enrichedResult[0][0].total) };
}

try {
  const configuredHost = (process.env.DB_HOST ?? '127.0.0.1').trim().toLowerCase();
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(configuredHost), 'Refusing to run: DB_HOST is not a local loopback address.');
  assert.notEqual((process.env.DB_NAME ?? '').trim().toLowerCase(), 'db_ac9392_licitapp', 'Refusing to run against the known SharkASP staging database.');
  const [targetRows] = await pool.query<any[]>('SELECT @@hostname server_host,@@port server_port,DATABASE() selected_database');
  assert.ok(targetRows[0]?.selected_database, 'MySQL did not select a database.');
  assert.notEqual(String(targetRows[0].selected_database).toLowerCase(), 'db_ac9392_licitapp', 'Refusing to run against the known SharkASP staging database.');
  const before = await inventory();
  const searches: any[] = [];
  for (const query of queries) {
    const result = await searchListings({ query, page: 1, pageSize: 10 }, { readOnly: true, useGroq: false, bypassCache: true });
    searches.push({
      query, total: result.total, provider: result.provider,
      items: result.items.map((item: any) => ({
        code: item.codigo_externo, title: item.nombre, status: item.codigo_estado, closes: item.fecha_cierre,
        relevance: item.compatibility, level: item.matchLevel, sources: item.matchSources,
        matchedKeywords: item.matchedKeywords, reasons: item.matchReasons,
      })),
    });
  }

  const firstPage = await searchListings({ query: 'mantención', page: 1, pageSize: 10 }, { readOnly: true, useGroq: false, bypassCache: true });
  const secondPage = await searchListings({ query: 'mantención', page: 2, pageSize: 10 }, { readOnly: true, useGroq: false, bypassCache: true });
  assert.ok(firstPage.items.length === 10 && secondPage.items.length === 10, 'Backend pagination must return the requested page size.');
  assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item: any) => item.codigo_externo)).size, 20, 'Adjacent result pages must not contain duplicate listings.');
  const filteredPendones = await searchListings({ query: 'pendones', page: 1, pageSize: 10, states: [5] }, { readOnly: true, useGroq: false, bypassCache: true });
  assert.ok(filteredPendones.items.length > 0 && filteredPendones.items.every((item: any) => Number(item.codigo_estado) === 5), 'Explicit status filter must be honored.');

  const [memberships] = await pool.query<any[]>(
    "SELECT user_id,company_id,role,status FROM company_memberships WHERE user_id=27 AND company_id=1 AND status='active' LIMIT 1",
  );
  assert.ok(memberships[0], 'Known local admin/company membership must still be active to validate Match context.');
  const membership = memberships[0];
  const [[companyData], [profileData], [productData]] = await Promise.all([
    pool.query<any[]>('SELECT id FROM companies WHERE id=?', [Number(membership.company_id)]),
    pool.query<any[]>('SELECT COUNT(*) total FROM commercial_profiles WHERE company_id=?', [Number(membership.company_id)]),
    pool.query<any[]>('SELECT COUNT(*) total FROM company_products WHERE company_id=? AND activo=1', [Number(membership.company_id)]),
  ]);
  const companyMatch = await runWithCompanyContext({
    userId: Number(membership.user_id), companyId: Number(membership.company_id),
    role: membership.role, platformRole: 'admin',
  }, () => getCompanyMatches());

  const after = await inventory();
  assert.deepEqual(after, before, 'Read-only validation must leave listing and indexed-item counts unchanged.');
  process.stdout.write(JSON.stringify({
    mode: 'MySQL transaction READ ONLY for all search queries; Groq disabled; no external API calls',
    mysql: { hostname: targetRows[0].server_host, port: Number(targetRows[0].server_port), database: targetRows[0].selected_database },
    inventory: { before, after },
    companyContext: { userId: Number(membership.user_id), companyId: Number(membership.company_id), role: membership.role },
    companyData: { activeCompanyFound: Boolean(companyData[0]), profiles: Number(profileData[0].total), activeProducts: Number(productData[0].total) },
    companyMatch: { configured: companyMatch.configured, total: companyMatch.total, high: companyMatch.high, medium: companyMatch.medium, exploratory: companyMatch.exploratory, candidatesEvaluated: companyMatch.candidatesEvaluated, items: companyMatch.items },
    queryValidation: { fallbackOnly: true, pagination: { pageOne: firstPage.items.length, pageTwo: secondPage.items.length, duplicateCodes: 0 }, stateFilter: { requested: 5, returned: filteredPendones.items.length, allMatch: true } },
    searches,
  }, null, 2) + '\n');
} finally {
  await pool.end();
}
