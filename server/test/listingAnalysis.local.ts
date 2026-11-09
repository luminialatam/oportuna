import assert from 'node:assert/strict';
import pool from '../src/db.js';
import { runWithCompanyContext } from '../src/companyRequestContext.js';
import { analyzeListing } from '../src/smartSearch.js';

assert.equal(process.env.GROQ_API_KEY?.trim() ?? '', '', 'Run this local QA with Groq disabled.');
const context = { userId: 27, role: 'admin' as const, platformRole: 'admin' as const, companyId: 1 };
const codes = ['5741-1-LE26', '2111-335-LE26', '609-29-LE26'];
async function snapshot() {
  const [counts] = await pool.query<any[]>(`SELECT COUNT(*) listings,COUNT(DISTINCT codigo_externo) unique_codes,
    (SELECT COUNT(*) FROM licitacion_items) item_rows FROM licitaciones`);
  const [[api]] = await pool.query<any[]>('SELECT detail_requests FROM mercado_publico_metrics WHERE id=1');
  return { listings: Number(counts[0].listings), uniqueCodes: Number(counts[0].unique_codes), itemRows: Number(counts[0].item_rows), apiRequests: Number(api.detail_requests) };
}

try {
  const before = await snapshot();
  assert.ok(before.listings>0);
  assert.equal(before.uniqueCodes, before.listings);
  const results = [];
  for (const code of codes) {
    const result = await runWithCompanyContext(context, () => analyzeListing(code));
    assert.equal(result.official.code, code);
    assert.equal(result.provider, 'fallback');
    assert.ok(result.official.availability);
    assert.ok(result.coverage.score >= 0 && result.coverage.score <= 100);
    assert.ok(result.commercialRelevance);
    if (code !== '609-29-LE26') assert.notEqual(result.official.availability.status, 'unknown');
    results.push({ code, provider: result.provider, availability: result.official.availability, itemCount: result.official.items.length, match: result.commercialRelevance, coverage: result.coverage.score });
  }
  const oven = results.find(item => item.code === '5741-1-LE26')!;
  const dishwasher = results.find(item => item.code === '2111-335-LE26')!;
  assert.equal(oven.itemCount, 1);
  assert.equal(dishwasher.itemCount, 1);
  const after = await snapshot();
  assert.deepEqual(after, before, 'analysis uses local facts and must not call Mercado Público or mutate listing/item inventory');
  process.stdout.write(JSON.stringify({ mode: 'local readonly integration; Groq disabled', before, after, cases: results }, null, 2) + '\n');
} finally {
  await pool.end();
}
