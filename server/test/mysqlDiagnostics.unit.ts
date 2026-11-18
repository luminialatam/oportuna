import assert from 'node:assert/strict';
import { classifyMysqlError, logMysqlFailure } from '../src/mysqlDiagnostics.js';

const cases: Array<[unknown, string]> = [
  [{ code: 'ER_ACCESS_DENIED_ERROR', errno: 1045 }, 'DB_ACCESS_DENIED'],
  [{ code: 'HANDSHAKE_SSL_ERROR' }, 'DB_TLS'],
  [{ code: 'EAI_AGAIN' }, 'DB_DNS'],
  [{ code: 'PROTOCOL_SEQUENCE_TIMEOUT', errno: 1205 }, 'DB_TIMEOUT'],
  [{ code: 'ECONNREFUSED', errno: -1 }, 'DB_CONNECTION_REFUSED'],
  [{ code: 'ER_BAD_DB_ERROR', errno: 1049 }, 'DB_SCHEMA'],
  [{ code: 'ER_TABLE_DOES_NOT_EXIST', message: 'DB_PASSWORD=secret-value' }, 'DB_UNKNOWN'],
];

for (const [error, expected] of cases) assert.equal(classifyMysqlError(error), expected);

const secretMessage = 'DB_PASSWORD=private-password; host=private-db.example; user=private-user; query=SELECT private_data';
const lines: string[] = [];
const loggedCode = logMysqlFailure('health_check', { code: 'ER_ACCESS_DENIED_ERROR', message: secretMessage }, (line) => lines.push(line));
assert.equal(loggedCode, 'DB_ACCESS_DENIED');
assert.deepEqual(lines, ['[db] health_check_failed code=DB_ACCESS_DENIED']);
assert.equal(lines.join('\n').includes(secretMessage), false);
assert.doesNotMatch(lines.join('\n'), /private-password|private-db\.example|private-user|private_data|SELECT/);

process.stdout.write('PASS MySQL failure classification uses generic codes and never logs raw error details.\n');
