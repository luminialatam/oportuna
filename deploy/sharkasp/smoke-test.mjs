const origin = process.argv[2] || 'https://luminiadev-001-site5.ltempurl.com';
const base = new URL(origin);

if (base.protocol !== 'https:') {
  process.stderr.write('Usa el origen HTTPS de staging.\n');
  process.exit(2);
}

const timeout = AbortSignal.timeout(15000);

try {
  const page = await fetch(new URL('/', base), { signal: timeout, redirect: 'error' });
  const html = page.ok ? await page.text() : '';
  const frontendOk = page.ok && /<html[\s>]/i.test(html) && /<div[^>]+id=["']root["']/i.test(html);
  process.stdout.write(`Frontend: HTTP ${page.status}; ${frontendOk ? 'OK' : 'respuesta inesperada'}.\n`);

  const api = await fetch(new URL('/api/health', base), { signal: timeout, redirect: 'error' });
  let health;
  try { health = await api.json(); } catch { health = null; }
  const apiOk = api.ok && health?.ok === true;
  const mysqlOk = health?.mysql === true;
  process.stdout.write(`API: HTTP ${api.status}; ${apiOk ? 'OK' : 'ERROR'}.\n`);
  process.stdout.write(`MySQL: ${mysqlOk ? 'conectado' : 'no conectado'}.\n`);
  process.exitCode = frontendOk && apiOk && mysqlOk ? 0 : 1;
} catch (error) {
  process.stderr.write(`Smoke test fallido: ${error instanceof Error ? error.name : 'error de red'}.\n`);
  process.exitCode = 1;
}
