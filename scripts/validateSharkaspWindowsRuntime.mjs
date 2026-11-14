import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import argon2 from 'argon2';

const root = process.cwd();
assert.equal(process.platform, 'win32', 'El runtime de SharkASP para esta aplicación es IIS/Windows; no empaquetar desde Railpack/Linux.');
assert.equal(process.arch, 'x64', 'Argon2 requiere el runtime Windows x64 confirmado para el Node App IIS.');
assert.ok(Number(process.versions.node.split('.')[0]) >= 18, 'La aplicación requiere Node.js 18 o posterior.');

for (const relativePath of [
  'dist/index.html',
  'dist-server/server/src/index.js',
  'deploy/sharkasp/production-bootstrap.mjs',
  'package.json',
  'package-lock.json',
]) {
  const path = resolve(root, relativePath);
  assert.ok(existsSync(path) && statSync(path).isFile(), `Falta el archivo de release ${relativePath}.`);
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.ok(manifest.dependencies?.argon2, 'Argon2 debe permanecer como dependencia runtime.');
const encoded = await argon2.hash('oportuna-windows-runtime-check');
assert.ok(await argon2.verify(encoded, 'oportuna-windows-runtime-check'), 'Argon2 no completó el chequeo nativo en Windows x64.');

process.stdout.write(`Windows runtime validado: Node ${process.versions.node}, ${process.platform}/${process.arch}, Argon2 nativo y build frontend/API presentes.\n`);
