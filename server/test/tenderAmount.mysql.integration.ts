import 'dotenv/config';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { tenderAmountUpsertSql } from '../src/tenderAmount.js';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'oportuna',
});

try {
  await connection.query(`CREATE TEMPORARY TABLE qa_tender_amount (
    codigo_externo VARCHAR(40) PRIMARY KEY,
    monto_estimado DECIMAL(20,4) NULL,
    payload_json JSON NULL
  )`);
  const upsert = `INSERT INTO qa_tender_amount (codigo_externo,monto_estimado,payload_json)
    VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${tenderAmountUpsertSql},
    payload_json=JSON_MERGE_PATCH(COALESCE(payload_json,JSON_OBJECT()),VALUES(payload_json))`;

  await connection.execute(upsert, ['QA-AMOUNT-1', 19_000_000, JSON.stringify({ MontoEstimado: 19_000_000, VisibilidadMonto: 1 })]);
  await connection.execute(upsert, ['QA-AMOUNT-1', null, JSON.stringify({ Nombre: 'listado resumido' })]);
  let [[row]] = await connection.query<any[]>('SELECT monto_estimado FROM qa_tender_amount WHERE codigo_externo=?', ['QA-AMOUNT-1']);
  assert.equal(Number(row.monto_estimado), 19_000_000, 'a later summary without amount fields must preserve the official amount');

  await connection.execute(upsert, ['QA-AMOUNT-1', null, JSON.stringify({ MontoEstimado: null, VisibilidadMonto: 0 })]);
  [[row]] = await connection.query<any[]>('SELECT monto_estimado FROM qa_tender_amount WHERE codigo_externo=?', ['QA-AMOUNT-1']);
  assert.equal(row.monto_estimado, null, 'an explicit official non-public flag must clear a stale amount');
  console.log('PASS MySQL amount persistence: writes official value, preserves omitted summary fields, clears explicit non-public value.');
} finally {
  await connection.end();
}
