import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_NAME !== 'oportuna') {
  throw new Error('Email integration schema can only be prepared in the isolated GitHub Actions MySQL service.');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  multipleStatements: true,
});

try {
  await connection.query('CREATE DATABASE IF NOT EXISTS oportuna CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  for (const migration of [
    '001_initial.sql',
    '009_company_profile_catalog.sql',
    '012_authentication.sql',
    '014_company_product_commercial_types.sql',
    '015_saas_onboarding.sql',
    '016_email_verification.sql',
    '018_company_subscriptions.sql',
  ]) {
    const sql = await readFile(resolve('server/migrations', migration), 'utf8');
    await connection.query(sql);
  }
  process.stdout.write('PASS isolated email QA schema prepared in GitHub Actions MySQL.\n');
} finally {
  await connection.end();
}
