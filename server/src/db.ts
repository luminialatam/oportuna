import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createMysqlTlsOptions } from './mysqlTlsConfig.js';

const ssl = createMysqlTlsOptions();

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root', password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'oportuna', waitForConnections: true, connectionLimit: 8,
  timezone: 'Z', decimalNumbers: false,
  ...(ssl ? { ssl } : {}),
});
export default pool;
