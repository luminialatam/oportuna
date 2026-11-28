const origin = process.argv[2] || 'https://tailflow.pro';
const base = new URL(origin);

if (base.protocol !== 'https:') {
  process.stderr.write('Usa el origen HTTPS de Oportuna.\n');
  process.exit(2);
}

async function checkFrontend() {
  try {
    const page = await fetch(new URL('/', base), { signal: AbortSignal.timeout(15000), redirect: 'error' });
    const html = page.ok ? await page.text() : '';
    const ok = page.ok && /<html[\s>]/i.test(html) && /<div[^>]+id=["']root["']/i.test(html);
    process.stdout.write(`Frontend GET /: HTTP ${page.status}; ${ok ? 'OK' : 'respuesta inesperada'}.\n`);
    return ok;
  } catch (error) {
    process.stderr.write(`Frontend GET /: sin respuesta (${error instanceof Error ? error.name : 'error de red'}).\n`);
    return false;
  }
}

async function checkApi() {
  try {
    const api = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(15000), redirect: 'error' });
    let health;
    try { health = await api.json(); } catch { health = null; }
    const apiOk = api.ok && health?.ok === true;
    const mysqlOk = health?.mysql === true;
    process.stdout.write(`API GET /api/health: HTTP ${api.status}; ${apiOk ? 'OK' : 'ERROR'}.\n`);
    process.stdout.write(`MySQL: ${mysqlOk ? 'conectado' : 'no conectado'}.\n`);
    return apiOk && mysqlOk;
  } catch (error) {
    process.stderr.write(`API GET /api/health: sin respuesta (${error instanceof Error ? error.name : 'error de red'}).\n`);
    process.stdout.write('MySQL: estado no comprobado.\n');
    return false;
  }
}

const frontendOk = await checkFrontend();
const apiOk = await checkApi();
process.exitCode = frontendOk && apiOk ? 0 : 1;
