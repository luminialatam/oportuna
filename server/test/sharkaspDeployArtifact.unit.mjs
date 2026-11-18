import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const site = await mkdtemp(join(tmpdir(), 'oportuna-sharkasp-artifact-'));
try {
  await cp(join(root, 'dist'), join(site, 'dist'), { recursive: true });
  await cp(join(root, 'dist-server'), join(site, 'dist-server'), { recursive: true });
  await cp(join(root, 'web.config'), join(site, 'web.config'));
  await cp(join(root, 'sharkasp-bootstrap.mjs'), join(site, 'sharkasp-bootstrap.mjs'));
  await cp(join(root, 'package.json'), join(site, 'package.json'));
  await writeFile(join(site, 'index.html'), '<script type="module" src="/src/main.tsx"></script>\n');
  await mkdir(join(site, 'assets'));
  await writeFile(join(site, 'assets', 'stale.txt'), 'must not satisfy current build');

  const result = spawnSync(process.execPath, [join(root, 'scripts/prepareSharkaspDeployRoot.mjs'), site], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const html = await readFile(join(site, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\/src\/main\.tsx|@vite\/client/);
  assert.match(html, /\/assets\/index-[A-Za-z0-9_-]+\.js/);
  assert.match(html, /\/assets\/index-[A-Za-z0-9_-]+\.css/);
  const config = await readFile(join(site, 'web.config'), 'utf8');
  assert.match(config, /arguments="sharkasp-bootstrap\.mjs"/);
  assert.match(config, /value="%HTTP_PLATFORM_PORT%"/);
  assert.doesNotMatch(config, /<rewrite\b/i);
  console.log('PASS SharkASP deploy artifact: root index is the hashed dist build; referenced assets exist; IIS routes all requests to the dynamic-port Node bootstrap.');
} finally {
  await rm(site, { recursive: true, force: true });
}
