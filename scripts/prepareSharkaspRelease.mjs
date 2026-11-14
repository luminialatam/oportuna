import assert from 'node:assert/strict';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const root = process.cwd();
const destination = resolve(process.argv[2] ?? 'sharkasp-release');
assert.equal(process.platform, 'win32', 'La release para IIS se debe preparar en Windows x64.');
assert.equal(process.arch, 'x64', 'La release requiere Windows x64.');
assert.notEqual(destination, root, 'La carpeta de release no puede sobrescribir el repositorio.');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const name of ['dist', 'dist-server', 'node_modules']) {
  await cp(join(root, name), join(destination, name), { recursive: true, errorOnExist: true });
}
for (const name of ['package.json', 'package-lock.json']) await cp(join(root, name), join(destination, name));
await cp(join(root, 'deploy/sharkasp/productionConfig.mjs'), join(destination, 'productionConfig.mjs'));
await cp(join(root, 'deploy/sharkasp/production-bootstrap.mjs'), join(destination, 'sharkasp-bootstrap.mjs'));

const forbidden = /^(?:\.env(?:\..*)?|secrets\.json|.*\.(?:sql|dump|bak|backup|pem|key|p12|pfx|secret|credentials|token))$/i;
const files = [];
async function walk(folder, relative = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const current = join(folder, entry.name);
    const rel = join(relative, entry.name).replaceAll('\\', '/');
    assert.ok(!forbidden.test(entry.name), `Archivo no permitido en release: ${rel}`);
    if (entry.isDirectory()) await walk(current, rel);
    else files.push({ path: rel, bytes: (await readFile(current)).byteLength });
  }
}
await walk(destination);
const html = await readFile(join(destination, 'dist/index.html'), 'utf8');
assert.match(html, /<div[^>]+id=["']root["']/i, 'Falta el punto de montaje React en dist/index.html.');
assert.ok(files.some(({ path }) => path === 'dist-server/server/src/index.js'), 'Falta el entrypoint API compilado.');
assert.ok(files.some(({ path }) => path === 'sharkasp-bootstrap.mjs'), 'Falta el start file esperado por el Node App IIS.');
assert.ok(!files.some(({ path }) => path.toLowerCase() === 'web.config'), 'web.config debe permanecer administrado en SharkASP y no se publica.');

const manifest = {
  platform: `${process.platform}/${process.arch}`,
  node: process.versions.node,
  files: files.length,
  bytes: files.reduce((sum, item) => sum + item.bytes, 0),
  sha256: createHash('sha256').update(files.map((file) => `${file.path}:${file.bytes}`).join('\n')).digest('hex'),
  includes: ['dist/', 'dist-server/', 'node_modules/', 'sharkasp-bootstrap.mjs', 'productionConfig.mjs'],
  excludes: ['web.config', '.env files', 'database files', 'private secret files'],
};
await writeFile(join(destination, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`Release IIS preparada: ${manifest.files} archivos de aplicación; Windows x64; web.config, secretos y datos excluidos. No se creó ZIP.\n`);
