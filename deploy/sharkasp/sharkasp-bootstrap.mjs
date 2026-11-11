import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = existsSync(join(scriptDirectory, 'dist-server'))
  ? scriptDirectory
  : resolve(scriptDirectory, '../..');
const entrypoint = join(appRoot, 'dist-server', 'server', 'src', 'index.js');
const args = new Set(process.argv.slice(2));
const diagnoseOnly = args.has('--diagnose');
const simulateIis = args.has('--simulate-iis');
const simulationSecretArgument = process.argv.find((arg) => arg.startsWith('--simulate-secrets-file='));

const fixedEnvironment = {
  APP_ENV: 'staging',
  NODE_ENV: 'production',
  PROCESS_ROLE: 'web',
  HOST: '127.0.0.1',
  CLIENT_ORIGIN: 'https://luminiadev-001-site5.ltempurl.com',
  DB_HOST: 'mysql1002.site4now.net',
  DB_PORT: '3306',
  DB_NAME: 'db_ac9392_licitapp',
  DB_USER: 'ac9392_licitapp',
  DB_SSL: 'true',
  DB_SSL_MODE: 'SHARKASP_STAGING_COMPAT',
  DB_SSL_SHARKASP_COMPAT: 'true',
  DB_SSL_CA: '',
  DB_SSL_CA_SHA256: '',
  TRUST_PROXY_HOPS: '1',
  SYNC_SCHEDULER_ENABLED: 'false',
  ENRICHMENT_WORKER_ENABLED: 'false',
  ALERT_SCHEDULER_ENABLED: 'false',
  RATE_LIMIT_SHARED: 'true',
};
const requiredPrivateVariables = ['DB_PASSWORD', 'MERCADOPUBLICO_TICKET', 'SYNC_API_TOKEN'];
const allowedSecretVariables = new Set([...requiredPrivateVariables, 'GROQ_API_KEY']);

function isInside(candidate, parent) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function loadPrivateSecrets() {
  if (simulationSecretArgument && !simulateIis) return { error: 'La ruta de secretos simulada solo se admite con --simulate-iis.' };
  // Do not fall back to values inherited from the shared IIS application pool.
  for (const name of allowedSecretVariables) delete process.env[name];
  const secretPath = simulationSecretArgument
    ? resolve(simulationSecretArgument.slice('--simulate-secrets-file='.length))
    : resolve(appRoot, '..', 'oportuna-private', 'secrets.json');
  if (!existsSync(secretPath)) return { error: `Falta el archivo privado; faltan ${requiredPrivateVariables.join(', ')}.` };
  const stat = lstatSync(secretPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 2 || stat.size > 8192) {
    return { error: 'El archivo privado debe ser un archivo regular, pequeño y no ser un enlace.' };
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    return { error: 'En sistemas POSIX el archivo privado debe tener permisos 0600.' };
  }
  const actualPath = realpathSync(secretPath);
  if (isInside(actualPath, realpathSync(appRoot))) return { error: 'El archivo privado debe estar fuera de la raíz web de Liciapp.' };
  let values;
  try {
    values = JSON.parse(readFileSync(actualPath, 'utf8'));
  } catch {
    return { error: 'El archivo privado no es JSON válido o no pudo leerse.' };
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { error: 'El archivo privado debe ser un objeto JSON.' };
  const unexpected = Object.keys(values).filter((name) => !allowedSecretVariables.has(name));
  if (unexpected.length) return { error: 'El archivo privado contiene campos no permitidos.' };
  for (const name of allowedSecretVariables) {
    const value = values[name];
    if (value == null && name === 'GROQ_API_KEY') continue;
    if (typeof value !== 'string' || !value.trim()) return { error: `El archivo privado requiere un valor de texto para ${name}.` };
    process.env[name] = value;
  }
  return { path: actualPath };
}

function fail(message) {
  process.stderr.write(`[sharkasp-bootstrap] ERROR: ${message}\n`);
  process.exit(1);
}

function summarize() {
  const portSource = process.env.HTTP_PLATFORM_PORT?.trim() ? 'HTTP_PLATFORM_PORT' : 'PORT';
  const portValue = process.env.HTTP_PLATFORM_PORT?.trim() || process.env.PORT?.trim();
  if (!portValue || !/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
    return { error: 'El puerto HTTP_PLATFORM_PORT/PORT falta o no es válido.' };
  }
  process.env.PORT = portValue;
  Object.assign(process.env, fixedEnvironment);

  const privateSecrets = loadPrivateSecrets();
  if (privateSecrets.error) return privateSecrets;

  const dotenvDisabledPath = join(appRoot, '.oportuna-dotenv-disabled');
  if (existsSync(dotenvDisabledPath)) return { error: 'Retira el archivo marcador de dotenv antes de iniciar.' };
  process.env.DOTENV_CONFIG_PATH = dotenvDisabledPath;

  const missing = requiredPrivateVariables.filter((name) => !process.env[name]?.trim());
  if (process.env.SYNC_API_TOKEN?.trim() && process.env.SYNC_API_TOKEN.trim().length < 32) {
    missing.push('SYNC_API_TOKEN (debe tener al menos 32 caracteres)');
  }

  const windowsArgonBinary = join(appRoot, 'node_modules', 'argon2', 'prebuilds', 'win32-x64', 'argon2.glibc.node');
  const argonPackage = join(appRoot, 'node_modules', 'argon2', 'package.json');
  const windowsArgonPresent = existsSync(windowsArgonBinary) && statSync(windowsArgonBinary).isFile();
  const argonPackagePresent = existsSync(argonPackage);
  const hostPlatformOk = process.platform === 'win32' && process.arch === 'x64';

  process.stdout.write(`[sharkasp-bootstrap] node=${process.versions.node}; host=${process.platform}/${process.arch}${hostPlatformOk || simulateIis ? '' : ' (no es Windows x64)'}\n`);
  process.stdout.write(`[sharkasp-bootstrap] entrypoint=${existsSync(entrypoint) ? 'present' : 'MISSING'}; port_source=${portSource}; port=${portValue ? 'valid' : 'MISSING'}\n`);
  process.stdout.write('[sharkasp-bootstrap] config: APP_ENV=staging; NODE_ENV=production; PROCESS_ROLE=web; DB_SSL=true; DB_SSL_MODE=SHARKASP_STAGING_COMPAT; DB_TARGET=locked; TRUST_PROXY_HOPS=1\n');
  process.stdout.write(`[sharkasp-bootstrap] workers: sync=${process.env.SYNC_SCHEDULER_ENABLED}; enrichment=${process.env.ENRICHMENT_WORKER_ENABLED}; alerts=${process.env.ALERT_SCHEDULER_ENABLED}\n`);
  process.stdout.write(`[sharkasp-bootstrap] private vars: ${requiredPrivateVariables.map((name) => `${name}=${process.env[name]?.trim() ? 'present' : 'MISSING'}`).join('; ')}; GROQ_API_KEY=${process.env.GROQ_API_KEY?.trim() ? 'present (optional)' : 'missing (optional)'}\n`);
  process.stdout.write(`[sharkasp-bootstrap] secrets_file=readable; outside_web_root=true; ACL=not-verifiable-by-Node\n`);
  process.stdout.write(`[sharkasp-bootstrap] argon2_package=${argonPackagePresent ? 'present' : 'MISSING'}; win32-x64_binary=${windowsArgonPresent ? 'present' : 'MISSING'}\n`);

  if (!existsSync(entrypoint)) return { error: 'No existe dist-server/server/src/index.js.' };
  if (!hostPlatformOk && !simulateIis) return { error: 'El sitio debe iniciar con Node.js Windows x64.' };
  if (!windowsArgonPresent || !argonPackagePresent) return { error: 'Falta Argon2 runtime o su binario Windows x64.' };
  if (missing.length) return { error: `Faltan variables privadas requeridas: ${missing.join(', ')}.` };
  return { portSource, port: portValue, dotenvDisabledPath };
}

function safeError(error) {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : 'Error de inicio no clasificado';
  for (const name of [...requiredPrivateVariables, 'GROQ_API_KEY']) {
    const value = process.env[name];
    if (value) message = message.split(value).join('[redacted]');
  }
  message = message.replace(/(password|ticket|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

const diagnostic = summarize();
if (diagnostic.error) fail(diagnostic.error);

if (diagnoseOnly) {
  try {
    const argon2 = await import('argon2');
    await argon2.hash('oportuna-sharkasp-native-module-check');
    process.stdout.write('[sharkasp-bootstrap] diagnostic=PASS; Argon2 cargó y completó prueba en memoria; no se consultó MySQL.\n');
  } catch (error) {
    fail(`Argon2 no pudo cargarse: ${safeError(error)}`);
  }
  process.exit(0);
}

process.once('uncaughtException', (error) => {
  process.stderr.write(`[sharkasp-bootstrap] uncaughtException ${safeError(error)}\n`);
  process.exit(1);
});
process.once('unhandledRejection', (error) => {
  process.stderr.write(`[sharkasp-bootstrap] unhandledRejection ${safeError(error)}\n`);
  process.exit(1);
});

try {
  await import(pathToFileURL(entrypoint).href);
} catch (error) {
  fail(`No inició dist-server/server/src/index.js: ${safeError(error)}`);
}
