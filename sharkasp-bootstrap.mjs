import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));
const entrypoint = join(appRoot, 'dist-server', 'server', 'src', 'index.js');

function fail(message) {
  process.stderr.write(`[oportuna-iis-startup] ERROR: ${message}\n`);
  process.exit(1);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  fail('Este archivo es para Node.js Application de SharkASP en Windows x64; Railpack debe iniciar con npm start.');
}

const port = process.env.HTTP_PLATFORM_PORT?.trim() || process.env.PORT?.trim();
if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  fail('IIS no proporcionó un HTTP_PLATFORM_PORT/PORT válido.');
}
if (!existsSync(entrypoint) || !existsSync(join(appRoot, 'dist', 'index.html'))) {
  fail('Falta el build frontend/API requerido.');
}

process.env.PORT = port;
// Do not let a deployed .env file silently override the Node App's environment.
process.env.DOTENV_CONFIG_PATH = join(appRoot, '.oportuna-dotenv-disabled');
process.stdout.write(`[oportuna-iis-startup] node=${process.versions.node}; host=win32/x64; port=valid; build=present.\n`);

try {
  const { loadRuntimeConfig } = await import(pathToFileURL(join(appRoot, 'dist-server', 'server', 'src', 'runtimeConfig.js')).href);
  loadRuntimeConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : 'configuración no válida';
  fail(`runtimeConfig: ${message}`);
}

try {
  await import(pathToFileURL(entrypoint).href);
} catch (error) {
  process.stderr.write(`[oportuna-iis-startup] ERROR: servidor no iniciado (${error instanceof Error ? error.name : 'error no clasificado'}).\n`);
  process.exit(1);
}
