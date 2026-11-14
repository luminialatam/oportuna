import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateProductionEnvironment } from './productionConfig.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const entrypoint = join(root, 'dist-server', 'server', 'src', 'index.js');
const frontend = join(root, 'dist', 'index.html');
const port = String(process.env.HTTP_PLATFORM_PORT ?? process.env.PORT ?? '').trim();
if (port) process.env.PORT = port;
process.env.DOTENV_CONFIG_PATH = join(root, '.oportuna-dotenv-disabled');

function fail(message) {
  process.stderr.write(`[oportuna-bootstrap] ERROR: ${message}\n`);
  process.exit(1);
}

if (process.platform !== 'win32' || process.arch !== 'x64') fail('Este artefacto requiere el Node App IIS Windows x64; no es compatible con Railpack/Linux.');
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) fail('HTTP_PLATFORM_PORT/PORT no está disponible o no es válido.');
const config = validateProductionEnvironment();
if (config.missing.length || config.invalid.length) {
  const fields = [...config.missing.map((name) => `falta ${name}`), ...config.invalid.map((name) => `inválida ${name}`)];
  fail(`configuración incompleta (${fields.join(', ')}); no se muestran valores.`);
}
if (existsSync(process.env.DOTENV_CONFIG_PATH)) fail('Existe un marcador dotenv inesperado; se detiene el inicio.');
if (!existsSync(frontend) || !existsSync(entrypoint)) fail('Falta el build frontend/API requerido.');

try {
  const argon2 = await import('argon2');
  const hash = await argon2.hash('oportuna-native-runtime-check');
  if (!(await argon2.verify(hash, 'oportuna-native-runtime-check'))) throw new Error('native-check-failed');
} catch {
  fail('Argon2 nativo no pudo iniciar en Windows x64.');
}

process.stdout.write(`[oportuna-bootstrap] node=${process.versions.node}; host=win32/x64; role=web; port=valid; frontend=present; API=ready-to-start.\n`);
try {
  await import(pathToFileURL(entrypoint).href);
} catch (error) {
  process.stderr.write(`[oportuna-bootstrap] ERROR: el servidor no inició (${error instanceof Error ? error.name : 'error no clasificado'}).\n`);
  process.exit(1);
}
