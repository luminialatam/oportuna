export type MysqlDiagnosticCode =
  | 'DB_ACCESS_DENIED'
  | 'DB_TLS'
  | 'DB_DNS'
  | 'DB_TIMEOUT'
  | 'DB_CONNECTION_REFUSED'
  | 'DB_SCHEMA'
  | 'DB_UNKNOWN';

export type MysqlFailureSite = 'health_check' | 'request_guard';

function mysqlErrorFields(error: unknown): { code: string; errno: number | undefined } {
  if (typeof error !== 'object' || error === null) return { code: '', errno: undefined };
  const fields = error as Record<string, unknown>;
  return {
    code: typeof fields.code === 'string' ? fields.code.trim().toUpperCase() : '',
    errno: typeof fields.errno === 'number' ? fields.errno : undefined,
  };
}

export function classifyMysqlError(error: unknown): MysqlDiagnosticCode {
  const { code, errno } = mysqlErrorFields(error);

  if ([1044, 1045].includes(errno ?? -1) || /ACCESS_DENIED|DBACCESS_DENIED|TABLEACCESS_DENIED|NOT_SUPPORTED_AUTH_MODE/.test(code)) {
    return 'DB_ACCESS_DENIED';
  }
  if (/TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|HANDSHAKE_SSL/.test(code)) return 'DB_TLS';
  if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL|EAI_NONAME/.test(code) || errno === 2005) return 'DB_DNS';
  if ([1205, 3024, 2013].includes(errno ?? -1) || /TIMEOUT|ETIMEDOUT/.test(code)) return 'DB_TIMEOUT';
  if (errno === 2003 || code === 'ECONNREFUSED') return 'DB_CONNECTION_REFUSED';
  if ([1049, 1054, 1146].includes(errno ?? -1) || /BAD_DB|BAD_FIELD|NO_SUCH_TABLE|WRONG_DB|NO_SUCH_INDEX/.test(code)) {
    return 'DB_SCHEMA';
  }
  return 'DB_UNKNOWN';
}

export function logMysqlFailure(
  site: MysqlFailureSite,
  error: unknown,
  write: (line: string) => void = (line) => console.error(line),
): MysqlDiagnosticCode {
  const code = classifyMysqlError(error);
  write(`[db] ${site}_failed code=${code}`);
  return code;
}
