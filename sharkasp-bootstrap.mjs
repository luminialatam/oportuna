import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = dirname(fileURLToPath(import.meta.url));
const entrypoint = join(appRoot, 'dist-server', 'server', 'src', 'index.js');

function fail(message) {
  process.stderr.write(`[oportuna-iis-startup] ERROR: ${message}\n`);
  process.exit(1);
}

const privateVariableNames = ['DB_PASSWORD', 'MERCADOPUBLICO_TICKET', 'SYNC_API_TOKEN', 'SMTP_PASSWORD', 'GROQ_API_KEY'];
function safeError(error) {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : 'Error de inicio no clasificado';
  for (const name of privateVariableNames) {
    const value = process.env[name];
    if (value) message = message.split(value).join('[redacted]');
  }
  message = message.replace(/(password|ticket|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 400);
}

function diagnostic(code, detail = '') {
  const safeDetail = detail ? ` detail=${detail.replace(/[\r\n]+/g, ' ').slice(0, 400)}` : '';
  process.stderr.write(`[oportuna-iis-startup] status=failed code=${code}${safeDetail}\n`);
  process.exit(1);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  fail('Este archivo es para Node.js Application de SharkASP en Windows x64; Railpack debe iniciar con npm start.');
}

const port = process.env.HTTP_PLATFORM_PORT?.trim() || process.env.PORT?.trim();
if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  diagnostic('DYNAMIC_PORT_INVALID');
}
if (!existsSync(entrypoint) || !existsSync(join(appRoot, 'dist', 'index.html'))) {
  diagnostic('BUILD_FILES_MISSING');
}

const portSource = process.env.HTTP_PLATFORM_PORT?.trim() ? 'HTTP_PLATFORM_PORT' : 'PORT';
process.env.PORT = port;
process.env.HOST = '127.0.0.1';
// Do not let a deployed .env file silently override the Node App's environment.
process.env.DOTENV_CONFIG_PATH = join(appRoot, '.oportuna-dotenv-disabled');
process.stdout.write(`[oportuna-iis-startup] phase=preflight node=${process.versions.node}; host=win32/x64; port_source=${portSource}; port=valid; bind=loopback; build=present.\n`);

try {
  const { loadRuntimeConfig } = await import(pathToFileURL(join(appRoot, 'dist-server', 'server', 'src', 'runtimeConfig.js')).href);
  loadRuntimeConfig();
} catch (error) {
  diagnostic('RUNTIME_CONFIG_INVALID', safeError(error));
}

try {
  await import('argon2');
  process.stdout.write('[oportuna-iis-startup] phase=native-dependencies status=ready argon2=loaded.\n');
} catch (error) {
  diagnostic('ARGON2_LOAD_FAILED', safeError(error));
}

process.once('uncaughtException', (error) => diagnostic('UNCAUGHT_EXCEPTION', safeError(error)));
process.once('unhandledRejection', (error) => diagnostic('UNHANDLED_REJECTION', safeError(error)));

try {
  await import(pathToFileURL(entrypoint).href);
  process.stdout.write('[oportuna-iis-startup] phase=entrypoint status=loaded.\n');
} catch (error) {
  diagnostic('SERVER_IMPORT_FAILED', safeError(error));
}
