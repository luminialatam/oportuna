import 'dotenv/config';

export type AppEnvironment = 'development' | 'staging' | 'production';
export type ProcessRole = 'all' | 'web' | 'sync-worker' | 'enrichment-worker' | 'alert-worker';

export interface RuntimeConfig {
  appEnv: AppEnvironment;
  processRole: ProcessRole;
  host: string;
  port: number;
  trustProxyHops: number;
  allowedOrigins: string[];
  secureCookies: boolean;
  sharedRateLimits: boolean;
  enrichmentWorkerEnabled: boolean;
  alertSchedulerEnabled: boolean;
}

const truthy = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const appEnv = (env.APP_ENV?.trim() || (env.NODE_ENV === 'production' ? '' : 'development')) as AppEnvironment;
  if (!['development', 'staging', 'production'].includes(appEnv)) {
    throw new Error('APP_ENV debe definirse como development, staging o production; no se permite asumir desarrollo con NODE_ENV=production.');
  }
  if (appEnv === 'development' && env.NODE_ENV === 'production') throw new Error('APP_ENV=development no es válido con NODE_ENV=production.');
  const processRole = (env.PROCESS_ROLE?.trim() || 'all') as ProcessRole;
  if (!['all', 'web', 'sync-worker', 'enrichment-worker', 'alert-worker'].includes(processRole)) {
    throw new Error('PROCESS_ROLE debe ser all, web, sync-worker, enrichment-worker o alert-worker.');
  }
  const port = Number(env.PORT || env.HTTP_PLATFORM_PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  const origins = (env.CLIENT_ORIGIN || 'http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.some((origin) => origin === '*' || !/^https?:\/\//i.test(origin))) {
    throw new Error('CLIENT_ORIGIN debe contener orígenes HTTP(S) explícitos; no se admite *.');
  }
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  const host = env.HOST?.trim() || '127.0.0.1';
  const dbSslMode = (env.DB_SSL_MODE?.trim().toUpperCase() || 'VERIFY_IDENTITY');
  if (dbSslMode !== 'VERIFY_IDENTITY' && dbSslMode !== 'VERIFY_CA' && dbSslMode !== 'SHARKASP_STAGING_COMPAT') {
    throw new Error('DB_SSL_MODE debe ser VERIFY_IDENTITY, VERIFY_CA o SHARKASP_STAGING_COMPAT.');
  }
  if (Boolean(env.DB_SSL_CA?.trim()) !== Boolean(env.DB_SSL_CA_SHA256?.trim())) {
    throw new Error('DB_SSL_CA y DB_SSL_CA_SHA256 deben configurarse juntos.');
  }
  if (dbSslMode === 'VERIFY_CA' && (!env.DB_SSL_CA?.trim() || !env.DB_SSL_CA_SHA256?.trim())) {
    throw new Error('VERIFY_CA requiere el PEM de confianza y su huella SHA-256 confirmada por el proveedor.');
  }
  if (dbSslMode === 'SHARKASP_STAGING_COMPAT') {
    const targetIsLocked = appEnv === 'staging'
      && env.NODE_ENV === 'production'
      && processRole === 'web'
      && env.DB_HOST?.trim().toLowerCase() === 'mysql1002.site4now.net'
      && Number(env.DB_PORT || 3306) === 3306
      && env.DB_NAME === 'db_ac9392_licitapp'
      && env.DB_USER === 'ac9392_licitapp';
    if (!targetIsLocked || env.DB_SSL !== 'true' || env.DB_SSL_SHARKASP_COMPAT !== 'true' || env.DB_SSL_CA || env.DB_SSL_CA_SHA256) {
      throw new Error('SHARKASP_STAGING_COMPAT solo se permite con TLS y opt-in para Liciapp staging.');
    }
  } else if (env.DB_SSL_SHARKASP_COMPAT === 'true') {
    throw new Error('DB_SSL_SHARKASP_COMPAT solo se admite con DB_SSL_MODE=SHARKASP_STAGING_COMPAT.');
  }
  if (appEnv !== 'development') {
    const required = ['HOST', 'CLIENT_ORIGIN', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'MERCADOPUBLICO_TICKET', 'SYNC_API_TOKEN'];
    const missing = required.filter((name) => !env[name]?.trim());
    if (missing.length) throw new Error(`Faltan variables obligatorias para ${appEnv}: ${missing.join(', ')}.`);
    if (!env.PROCESS_ROLE || !['web', 'sync-worker', 'enrichment-worker', 'alert-worker'].includes(env.PROCESS_ROLE)) throw new Error('PROCESS_ROLE debe identificar web, sync-worker, enrichment-worker o alert-worker fuera de development.');
    if (env.NODE_ENV !== 'production') throw new Error('NODE_ENV=production es obligatorio fuera de development.');
    if (!env.CLIENT_ORIGIN!.split(',').every((origin) => origin.trim().startsWith('https://'))) {
      throw new Error('CLIENT_ORIGIN debe usar HTTPS en staging y producción.');
    }
    if (!Number.isInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 5) {
      throw new Error('TRUST_PROXY_HOPS debe indicar entre 1 y 5 proxies confiables en staging y producción.');
    }
    if (!truthy(env.DB_SSL)) throw new Error('DB_SSL=true es obligatorio en staging y producción.');
    if (env.SYNC_API_TOKEN!.trim().length < 32) throw new Error('SYNC_API_TOKEN debe tener al menos 32 caracteres.');
    if (truthy(env.SYNC_SCHEDULER_ENABLED) && processRole !== 'sync-worker') throw new Error('SYNC_SCHEDULER_ENABLED solo puede activarse en PROCESS_ROLE=sync-worker.');
    if (truthy(env.ENRICHMENT_WORKER_ENABLED) && processRole !== 'enrichment-worker') throw new Error('ENRICHMENT_WORKER_ENABLED solo puede activarse en PROCESS_ROLE=enrichment-worker.');
    if (truthy(env.ALERT_SCHEDULER_ENABLED) && processRole !== 'alert-worker') throw new Error('ALERT_SCHEDULER_ENABLED solo puede activarse en PROCESS_ROLE=alert-worker.');
  }
  return {
    appEnv,
    processRole,
    host,
    port,
    trustProxyHops: appEnv === 'development' ? (Number.isInteger(trustProxyHops) && trustProxyHops >= 0 && trustProxyHops <= 5 ? trustProxyHops : 0) : trustProxyHops,
    allowedOrigins: origins,
    secureCookies: appEnv !== 'development',
    sharedRateLimits: appEnv !== 'development' || truthy(env.RATE_LIMIT_SHARED),
    enrichmentWorkerEnabled: appEnv === 'development' ? env.ENRICHMENT_WORKER_ENABLED !== 'false' : truthy(env.ENRICHMENT_WORKER_ENABLED),
    alertSchedulerEnabled: appEnv === 'development' ? truthy(env.ALERT_SCHEDULER_ENABLED) : truthy(env.ALERT_SCHEDULER_ENABLED),
  };
}
