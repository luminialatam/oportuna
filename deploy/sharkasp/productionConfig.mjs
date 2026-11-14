const required = [
  'APP_ENV', 'NODE_ENV', 'PROCESS_ROLE', 'HOST', 'CLIENT_ORIGIN', 'TRUST_PROXY_HOPS',
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL', 'DB_SSL_MODE',
  'MERCADOPUBLICO_TICKET', 'SYNC_API_TOKEN', 'EMAIL_TRANSPORT',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM',
];

export function validateProductionEnvironment(env = process.env, { requirePort = true } = {}) {
  const missing = required.filter((name) => !String(env[name] ?? '').trim());
  if (requirePort && !String(env.HTTP_PLATFORM_PORT ?? env.PORT ?? '').trim()) missing.push('HTTP_PLATFORM_PORT (IIS) o PORT');
  const invalid = [];
  if (env.APP_ENV !== 'production') invalid.push('APP_ENV');
  if (env.NODE_ENV !== 'production') invalid.push('NODE_ENV');
  if (env.PROCESS_ROLE !== 'web') invalid.push('PROCESS_ROLE');
  if (env.DB_SSL !== 'true') invalid.push('DB_SSL');
  const sslMode = String(env.DB_SSL_MODE ?? '').toUpperCase();
  if (!['VERIFY_IDENTITY', 'VERIFY_CA'].includes(sslMode)) invalid.push('DB_SSL_MODE');
  if (sslMode === 'VERIFY_CA' && (!String(env.DB_SSL_CA ?? '').trim() || !String(env.DB_SSL_CA_SHA256 ?? '').trim())) invalid.push('DB_SSL_CA, DB_SSL_CA_SHA256');
  if (env.EMAIL_TRANSPORT !== 'smtp') invalid.push('EMAIL_TRANSPORT');
  const smtpPort = Number(env.SMTP_PORT);
  if (!Number.isInteger(smtpPort) || ![465, 587].includes(smtpPort)) invalid.push('SMTP_PORT');
  if ((env.SMTP_PORT === '465' && env.SMTP_SECURE !== 'true') || (env.SMTP_PORT === '587' && env.SMTP_SECURE !== 'false')) invalid.push('SMTP_PORT, SMTP_SECURE');
  if (env.SMTP_FROM && !/^[^\s@<>]+@[^\s@<>]+$/.test(env.SMTP_FROM)) invalid.push('SMTP_FROM');
  if (env.SMTP_HOST && /[\s\r\n/@]/.test(env.SMTP_HOST)) invalid.push('SMTP_HOST');
  if (env.SMTP_HELO_NAME && /[\r\n]/.test(env.SMTP_HELO_NAME)) invalid.push('SMTP_HELO_NAME');
  const origins = String(env.CLIENT_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.some((value) => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value; }
    catch { return true; }
  })) invalid.push('CLIENT_ORIGIN');
  const hops = Number(env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) invalid.push('TRUST_PROXY_HOPS');
  const dbPort = Number(env.DB_PORT);
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) invalid.push('DB_PORT');
  if (String(env.SYNC_API_TOKEN ?? '').trim().length < 32) invalid.push('SYNC_API_TOKEN');
  const listenPort = env.HTTP_PLATFORM_PORT || env.PORT;
  if (requirePort && (!/^\d+$/.test(String(listenPort ?? '')) || Number(listenPort) < 1 || Number(listenPort) > 65535)) invalid.push('HTTP_PLATFORM_PORT o PORT');
  for (const name of ['SYNC_SCHEDULER_ENABLED', 'ENRICHMENT_WORKER_ENABLED', 'ALERT_SCHEDULER_ENABLED']) {
    if (String(env[name] ?? '').trim().toLowerCase() === 'true') invalid.push(name);
  }
  return { missing: [...new Set(missing)], invalid: [...new Set(invalid)] };
}
