const timeoutMs = 8_000;

export async function checkSharkaspSite(baseUrl, fetchImpl = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') throw new Error('La URL de smoke test debe usar HTTPS.');
  const root = await fetchImpl(new URL('/', base), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (!root.ok) throw new Error(`GET / respondió HTTP ${root.status}${iisHint(root)}.`);
  const html = await root.text();
  if (!/<!doctype html|<html[\s>]/i.test(html)) throw new Error('GET / no devolvió un documento HTML.');
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))(?:\?[^"']*)?["']/gi)].map((match) => match[1]);
  if (!assets.some((asset) => asset.endsWith('.js')) || !assets.some((asset) => asset.endsWith('.css'))) {
    throw new Error('El HTML no referencia los bundles JS y CSS compilados.');
  }
  for (const asset of assets) {
    const response = await fetchImpl(new URL(asset, base), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`GET ${asset} respondió HTTP ${response.status}${iisHint(response)}.`);
  }
  const health = await fetchImpl(new URL('/api/health', base), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (!health.ok) throw new Error(`GET /api/health respondió HTTP ${health.status}${iisHint(health)}.`);
  const contentType = health.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new Error('GET /api/health no devolvió JSON de Express.');
  const payload = await health.json();
  if (payload?.ok !== true || typeof payload.mysql !== 'boolean') throw new Error('La respuesta de /api/health no tiene el contrato esperado.');
  return { ok: true, mysql: payload.mysql, assets: assets.length };
}

function iisHint(response) {
  return response.headers.get('server')?.toLowerCase().includes('microsoft-iis') ? ' (respuesta de IIS; la solicitud no alcanzó Express)' : '';
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const target = process.env.SHARKASP_SMOKE_URL;
  if (!target) {
    process.stderr.write('Falta SHARKASP_SMOKE_URL (URL HTTPS de la aplicación).\n');
    process.exitCode = 2;
  } else {
    try {
      const result = await checkSharkaspSite(target);
      process.stdout.write(`PASS: HTML y ${result.assets} assets servidos; /api/health JSON disponible; mysql=${result.mysql}.\n`);
    } catch (error) {
      process.stderr.write(`FAIL: ${error instanceof Error ? error.message : 'fallo no clasificado'}\n`);
      process.exitCode = 1;
    }
  }
}
