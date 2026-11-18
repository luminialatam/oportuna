import assert from 'node:assert/strict';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const inPlace = args.includes('--in-place');
const positional = args.filter((arg) => arg !== '--in-place');
if (positional.length > 1) {
  process.stderr.write('Uso: node scripts/prepareSharkaspDeployRoot.mjs [raiz-temporal | --in-place]\n');
  process.exit(2);
}
const siteRoot = inPlace ? repositoryRoot : resolve(positional[0] ?? '');

async function requireFile(path, label) {
  const info = await stat(path).catch(() => null);
  assert.ok(info?.isFile(), `Falta ${label}.`);
}

async function main() {
  const dist = join(siteRoot, 'dist');
  const distIndex = join(dist, 'index.html');
  const distAssets = join(dist, 'assets');
  const rootIndex = join(siteRoot, 'index.html');
  const rootAssets = join(siteRoot, 'assets');
  const webConfigPath = join(siteRoot, 'web.config');
  const bootstrapPath = join(siteRoot, 'sharkasp-bootstrap.mjs');

  await requireFile(distIndex, 'dist/index.html compilado');
  await requireFile(join(siteRoot, 'dist-server', 'server', 'src', 'index.js'), 'servidor Node compilado');
  await requireFile(join(siteRoot, 'package.json'), 'package.json');
  await requireFile(bootstrapPath, 'sharkasp-bootstrap.mjs en la raíz');
  await requireFile(webConfigPath, 'web.config en la raíz');

  const webConfig = await readFile(webConfigPath, 'utf8');
  assert.match(webConfig, /<add\s+name=["']httpPlatformHandler["']\s+path=["']\*["']\s+verb=["']\*["']\s+modules=["']httpPlatformHandler["']/i,
    'web.config debe enviar todas las rutas a HttpPlatformHandler.');
  assert.match(webConfig, /<httpPlatform\s+processPath=["']node["']\s+arguments=["']sharkasp-bootstrap\.mjs["']/i,
    'web.config debe iniciar el bootstrap Node de la raíz.');
  assert.match(webConfig, /name=["']PORT["']\s+value=["']%HTTP_PLATFORM_PORT%["']/i,
    'web.config debe pasar el puerto dinámico HTTP_PLATFORM_PORT.');
  assert.doesNotMatch(webConfig, /<rewrite\b/i, 'web.config no debe interceptar API ni SPA mediante reglas rewrite.');

  await mkdir(rootAssets, { recursive: true });
  await cp(distIndex, rootIndex);
  await cp(distAssets, rootAssets, { recursive: true, force: true });

  const html = await readFile(rootIndex, 'utf8');
  assert.doesNotMatch(html, /\/src\/main\.tsx|@vite\/client/i,
    'la raíz no puede conservar el index.html de desarrollo de Vite.');
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => /^\/assets\/index-[A-Za-z0-9_-]+\.js(?:\?.*)?$/.test(asset)),
    'el index.html publicado debe referenciar el bundle JavaScript hashed.');
  assert.ok(assets.some((asset) => /^\/assets\/index-[A-Za-z0-9_-]+\.css(?:\?.*)?$/.test(asset)),
    'el index.html publicado debe referenciar el CSS hashed.');
  for (const asset of assets) {
    await requireFile(join(siteRoot, asset.replace(/^\//, '')), `asset referenciado ${asset}`);
  }

  process.stdout.write(`SharkASP root prepared and validated: index.html -> ${assets.filter((asset) => asset.endsWith('.js'))[0]}; assets and Node routing present.\n`);
}

main().catch((error) => {
  process.stderr.write(`Preparación SharkASP detenida: ${error instanceof Error ? error.message : 'error no clasificado'}\n`);
  process.exitCode = 1;
});
