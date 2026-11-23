// Safe staging defaults. Database identity and public origin come only from
// the staging site's process environment; credentials stay in its secret store.
const database = {
  host: process.env.DB_HOST?.trim() ?? '',
  port: process.env.DB_PORT?.trim() || '3306',
  name: process.env.DB_NAME?.trim() ?? '',
  user: process.env.DB_USER?.trim() ?? '',
};

const isLegacySharedDatabase = database.host.toLowerCase() === 'mysql1002.site4now.net'
  && database.port === '3306'
  && database.name === 'db_ac9392_licitapp';

export const fixedEnvironment = Object.freeze({
  APP_ENV: 'staging',
  OPORTUNA_DEPLOYMENT_PROFILE: 'isolated-staging',
  OPORTUNA_PRIVATE_SECRETS_PATH: process.env.OPORTUNA_PRIVATE_SECRETS_PATH?.trim() ?? '',
  NODE_ENV: 'production',
  PROCESS_ROLE: 'web',
  HOST: '127.0.0.1',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN?.trim() ?? '',
  DB_HOST: isLegacySharedDatabase ? '' : database.host,
  DB_PORT: database.port,
  DB_NAME: isLegacySharedDatabase ? '' : database.name,
  DB_USER: isLegacySharedDatabase ? '' : database.user,
  DB_SSL: 'true',
  DB_SSL_MODE: process.env.DB_SSL_MODE?.trim().toUpperCase() || 'VERIFY_IDENTITY',
  DB_SSL_CA: process.env.DB_SSL_CA?.trim() ?? '',
  DB_SSL_CA_SHA256: process.env.DB_SSL_CA_SHA256?.trim() ?? '',
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS?.trim() ?? '',
  SYNC_SCHEDULER_ENABLED: 'false',
  ENRICHMENT_WORKER_ENABLED: 'false',
  ALERT_SCHEDULER_ENABLED: 'false',
  RATE_LIMIT_SHARED: 'true',
});
