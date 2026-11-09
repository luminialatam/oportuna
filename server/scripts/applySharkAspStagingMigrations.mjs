import { readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';
import { createMysqlTlsOptions } from '../../dist-server/server/src/mysqlTlsConfig.js';

const TARGET = Object.freeze({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
});
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function askSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Ejecuta desde una Terminal interactiva para ingresar la contraseña oculta.');
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(new Error('Cancelado.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

function versionAtLeast(version, minimum) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const inspectOnly = process.argv.includes('--inspect');
  if (checkOnly && inspectOnly) throw new Error('Usa solo una opción de lectura por ejecución.');
  if (TARGET.host !== 'mysql1002.site4now.net' || TARGET.database !== 'db_ac9392_licitapp' || TARGET.user !== 'ac9392_licitapp') {
    throw new Error('DB_HOST, DB_NAME y DB_USER deben coincidir exactamente con el destino de staging confirmado.');
  }
  if (!Number.isInteger(TARGET.port) || TARGET.port < 1 || TARGET.port > 65535) throw new Error('DB_PORT no es válido.');
  const ssl = createMysqlTlsOptions(process.env);
  if (!ssl) throw new Error('Define DB_SSL=true; no se permite una conexión sin TLS.');
  const password = await askSecret('Contraseña MySQL staging (entrada oculta): ');
  if (!password) throw new Error('La contraseña no puede estar vacía.');

  const connection = await mysql.createConnection({
    ...TARGET,
    password,
    ssl,
    multipleStatements: true,
    connectTimeout: 15000,
  });
  try {
    const [[server]] = await connection.query(
      'SELECT VERSION() AS version, @@hostname AS serverHost, DATABASE() AS dbName, CURRENT_USER() AS account',
    );
    if (!String(server.version).startsWith('8.') || !versionAtLeast(String(server.version), [8, 0, 16])) {
      throw new Error('La versión remota no cumple MySQL 8.0.16 o superior.');
    }
    if (server.dbName !== TARGET.database || !String(server.account).startsWith(`${TARGET.user}@`)) {
      throw new Error('El esquema o usuario autenticado no coincide con el destino de staging configurado.');
    }
    const [[tls]] = await connection.query("SHOW SESSION STATUS WHERE Variable_name='Ssl_cipher'");
    if (!tls?.Value) throw new Error('La conexión no negoció TLS; no se continuará.');

    const [tableRows] = await connection.query(
      'SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name',
    );
    const [grantRows] = await connection.query('SHOW GRANTS');
    const grants = grantRows.map((row) => Object.values(row).join(' ')).join(' ').toUpperCase();
    const hasAll = grants.includes('ALL PRIVILEGES');
    const requiredPrivileges = ['CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'INSERT', 'SELECT', 'UPDATE'];
    const missingPrivileges = hasAll ? [] : requiredPrivileges.filter((privilege) => !grants.includes(privilege));
    const files = readdirSync(migrationsDirectory)
      .filter((name) => /^0(0[1-9]|1[0-3])_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
      .sort();
    if (files.length !== 13) throw new Error('No se encontraron exactamente las migraciones 001–013.');
    const mode = process.env.DB_SSL_MODE?.trim().toUpperCase() || 'VERIFY_IDENTITY';
    const tlsSummary = mode === 'SHARKASP_STAGING_COMPAT'
      ? 'TLS cifrado; certificado no autenticado (compatibilidad temporal)'
      : mode === 'VERIFY_CA' ? 'TLS con CA verificada; sin validación de hostname' : 'TLS con cadena y hostname verificados';
    process.stdout.write(`Destino verificado: ${TARGET.host} / ${server.dbName}; MySQL ${server.version}; ${tlsSummary}; tablas=${tableRows.length}.\n`);
    if (inspectOnly) {
      const [tables] = await connection.query(
        'SELECT table_name AS tableName, table_type AS tableType, engine, table_collation AS tableCollation FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name',
      );
      const [columns] = await connection.query(
        'SELECT table_name AS tableName, column_name AS columnName, column_type AS columnType, is_nullable AS nullable, column_key AS columnKey, extra FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position',
      );
      const [indexes] = await connection.query(
        'SELECT table_name AS tableName, index_name AS indexName, non_unique AS nonUnique, seq_in_index AS sequence, column_name AS columnName FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index',
      );
      const [constraints] = await connection.query(
        'SELECT table_name AS tableName, constraint_name AS constraintName, constraint_type AS constraintType FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() ORDER BY table_name, constraint_name',
      );
      const [foreignKeys] = await connection.query(
        'SELECT table_name AS tableName, constraint_name AS constraintName, column_name AS columnName, referenced_table_name AS referencedTable, referenced_column_name AS referencedColumn FROM information_schema.key_column_usage WHERE constraint_schema = DATABASE() AND referenced_table_name IS NOT NULL ORDER BY table_name, constraint_name, ordinal_position',
      );
      const presentTables = new Set(tables.map((row) => row.tableName));
      const rowCounts = {};
      for (const tableName of ['licitaciones', 'sync_runs', 'app_users']) {
        if (presentTables.has(tableName)) {
          const [[result]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${tableName}\``);
          rowCounts[tableName] = Number(result.total);
        }
      }
      process.stdout.write(`Tablas: ${JSON.stringify(tables)}\n`);
      process.stdout.write(`Columnas: ${JSON.stringify(columns)}\n`);
      process.stdout.write(`Índices: ${JSON.stringify(indexes)}\n`);
      process.stdout.write(`Restricciones: ${JSON.stringify(constraints)}\n`);
      process.stdout.write(`Claves foráneas: ${JSON.stringify(foreignKeys)}\n`);
      process.stdout.write(`Conteos de tablas relevantes: ${JSON.stringify(rowCounts)}\n`);
      process.stdout.write(`Migración 001 define tablas licitaciones y sync_runs; no se ejecutó SQL de escritura.\n`);
      return;
    }
    if (checkOnly) {
      process.stdout.write(`Tablas existentes: ${tableRows.length ? tableRows.map((row) => row.tableName).join(', ') : '(ninguna)'}\n`);
      process.stdout.write(`Permisos de migración: ${missingPrivileges.length ? `faltan ${missingPrivileges.join(', ')}` : 'suficientes'}.\n`);
      process.stdout.write(`Migraciones disponibles y ordenadas: ${files[0].slice(0, 3)}–${files.at(-1).slice(0, 3)} (${files.length}); down migration excluida.\n`);
      process.stdout.write('Modo --check: solo lectura; no se aplicó SQL.\n');
      return;
    }
    if (tableRows.length !== 0) throw new Error('La base no está vacía; no se ejecutará ninguna migración.');
    if (missingPrivileges.length) {
      throw new Error('El usuario no presenta todos los permisos requeridos para las migraciones.');
    }
    const migrations = files.map((name) => {
      const raw = readFileSync(join(migrationsDirectory, name), 'utf8');
      const sql = raw
        .replace(/^\s*CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+oportuna[^;]*;\s*/im, '')
        .replace(/^\s*USE\s+oportuna\s*;\s*/gim, '')
        .trim();
      if (/^\s*(CREATE\s+DATABASE|USE\s+)/im.test(sql)) throw new Error(`Selección de esquema inesperada en ${name}.`);
      return { name, sql };
    });

    const confirmation = `APLICAR 001-013 EN ${TARGET.host}/${TARGET.database}`;
    const typed = await ask(`Escribe exactamente «${confirmation}» para ejecutar las migraciones: `);
    if (typed !== confirmation) throw new Error('Confirmación incorrecta; no se ejecutó SQL.');

    for (const migration of migrations) {
      try {
        await connection.query(migration.sql);
        process.stdout.write(`Migración aplicada: ${migration.name.slice(0, 3)}\n`);
      } catch (error) {
        const details = error && typeof error === 'object' ? error : {};
        const code = 'code' in details ? String(details.code) : 'SQL_ERROR';
        const errno = 'errno' in details ? String(details.errno) : 'n/d';
        const sqlState = 'sqlState' in details ? String(details.sqlState) : 'n/d';
        const message = 'message' in details ? String(details.message).replace(/[\r\n]+/g, ' ').slice(0, 400) : 'sin detalle del controlador';
        throw new Error(`Falló ${migration.name.slice(0, 3)} (${code}; errno=${errno}; SQLSTATE=${sqlState}): ${message}. Detenerse y revisar el esquema antes de reintentar.`);
      }
    }

    const [[summary]] = await connection.query(
      `SELECT COUNT(*) AS totalTables FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type='BASE TABLE'`,
    );
    const [[fkSummary]] = await connection.query(
      'SELECT COUNT(*) AS totalForeignKeys FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()',
    );
    const [requiredRows] = await connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('licitaciones','app_users','company_memberships','company_alerts','app_rate_limits','sync_jobs','licitacion_items')",
    );
    if (requiredRows.length !== 7) throw new Error('La verificación posterior no encontró todas las tablas críticas.');
    process.stdout.write(`Verificación final: ${summary.totalTables} tablas; ${fkSummary.totalForeignKeys} claves foráneas; tablas críticas presentes.\n`);
    process.stdout.write('Migraciones 001–013 completas. No se creó ningún usuario ni se importaron datos.\n');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Migración detenida: ${error instanceof Error ? error.message : 'error inesperado'}\n`);
  process.exitCode = 1;
});
