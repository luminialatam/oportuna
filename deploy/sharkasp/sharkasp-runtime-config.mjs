// Public, non-secret process settings shared by the SharkASP bootstrap and its tests.
export const fixedEnvironment = Object.freeze({
  APP_ENV: 'staging',
  NODE_ENV: 'production',
  PROCESS_ROLE: 'web',
  HOST: '127.0.0.1',
  // Canonical origin is first because emailService uses the first configured origin.
  // The provider hostname remains available for the existing staging smoke/access path.
  CLIENT_ORIGIN: 'https://tailflow.pro,https://luminiadev-001-site5.ltempurl.com',
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
});
