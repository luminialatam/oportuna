import { X509Certificate } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SslOptions } from 'mysql2';

export type MysqlTlsMode = 'VERIFY_IDENTITY' | 'VERIFY_CA' | 'SHARKASP_STAGING_COMPAT';

function insideDirectory(candidate: string, directory: string): boolean {
  const pathFromRoot = relative(directory, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
}

export function createMysqlTlsOptions(env: NodeJS.ProcessEnv = process.env): SslOptions | undefined {
  if (env.DB_SSL !== 'true') {
    if (env.APP_ENV === 'staging' || env.APP_ENV === 'production' || env.NODE_ENV === 'production') {
      throw new Error('DB_SSL=true es obligatorio fuera de desarrollo.');
    }
    if ((env.DB_SSL_MODE?.trim().toUpperCase() && env.DB_SSL_MODE.trim().toUpperCase() !== 'VERIFY_IDENTITY') || env.DB_SSL_CA || env.DB_SSL_CA_SHA256 || env.DB_SSL_SHARKASP_COMPAT === 'true') {
      throw new Error('La configuración DB_SSL_MODE/DB_SSL_CA requiere DB_SSL=true.');
    }
    return undefined;
  }

  const mode = (env.DB_SSL_MODE?.trim().toUpperCase() || 'VERIFY_IDENTITY') as MysqlTlsMode;
  if (!['VERIFY_IDENTITY', 'VERIFY_CA', 'SHARKASP_STAGING_COMPAT'].includes(mode)) {
    throw new Error('DB_SSL_MODE debe ser VERIFY_IDENTITY, VERIFY_CA o SHARKASP_STAGING_COMPAT.');
  }

  if (mode === 'SHARKASP_STAGING_COMPAT') {
    const targetIsLocked = env.APP_ENV === 'staging'
      && env.NODE_ENV === 'production'
      && env.PROCESS_ROLE === 'web'
      && env.DB_HOST?.trim().toLowerCase() === 'mysql1002.site4now.net'
      && Number(env.DB_PORT || 3306) === 3306
      && env.DB_NAME === 'db_ac9392_licitapp'
      && env.DB_USER === 'ac9392_licitapp';
    if (!targetIsLocked || env.DB_SSL_SHARKASP_COMPAT !== 'true' || env.DB_SSL_CA || env.DB_SSL_CA_SHA256) {
      throw new Error('SHARKASP_STAGING_COMPAT requiere opt-in y queda limitado al host, esquema, usuario y rol web de staging de Liciapp.');
    }
    return { rejectUnauthorized: false, verifyIdentity: false };
  }

  const caPath = env.DB_SSL_CA?.trim();
  const configuredFingerprint = env.DB_SSL_CA_SHA256?.replace(/[:\s]/g, '').toUpperCase();
  let ca: string | undefined;

  if (caPath) {
    if (!isAbsolute(caPath)) throw new Error('DB_SSL_CA debe apuntar a una ruta absoluta fuera del proyecto.');
    const resolvedCaPath = realpathSync(caPath);
    if (insideDirectory(resolvedCaPath, realpathSync(process.cwd()))) {
      throw new Error('DB_SSL_CA debe estar fuera de la raíz del proyecto/publicación.');
    }
    ca = readFileSync(resolvedCaPath, 'utf8');
    const certBlocks = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    if (certBlocks.length !== 1 || ca.replace(certBlocks[0], '').trim()) {
      throw new Error('DB_SSL_CA debe contener exactamente un certificado PEM y ningún otro material.');
    }
    const certificate = new X509Certificate(certBlocks[0]);
    if (!configuredFingerprint || !/^[0-9A-F]{64}$/.test(configuredFingerprint)) {
      throw new Error('DB_SSL_CA_SHA256 debe contener la huella SHA-256 confirmada por SharkASP.');
    }
    const actualFingerprint = certificate.fingerprint256.replace(/:/g, '').toUpperCase();
    if (actualFingerprint !== configuredFingerprint) {
      throw new Error('La huella SHA-256 de DB_SSL_CA no coincide con la confirmada por SharkASP.');
    }
  } else if (configuredFingerprint) {
    throw new Error('DB_SSL_CA_SHA256 requiere DB_SSL_CA.');
  }

  if (mode === 'VERIFY_CA' && !ca) {
    throw new Error('VERIFY_CA requiere DB_SSL_CA y su huella DB_SSL_CA_SHA256 verificada.');
  }

  return {
    rejectUnauthorized: true,
    verifyIdentity: mode === 'VERIFY_IDENTITY',
    ...(ca ? { ca } : {}),
  };
}
