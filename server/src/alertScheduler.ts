import pool from './db.js';
import { evaluateAlertsForCompany } from './alertService.js';
import { loadRuntimeConfig } from './runtimeConfig.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function evaluateAllCompanies() {
  const config = loadRuntimeConfig();
  if (!['all','alert-worker'].includes(config.processRole) || !config.alertSchedulerEnabled || running) return;
  running = true;
  let connection: Awaited<ReturnType<typeof pool.getConnection>> | null = null;
  let locked = false;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query<any[]>("SELECT GET_LOCK('oportuna_alert_evaluation',0) acquired");
    locked = Number(rows[0]?.acquired) === 1;
    if (!locked) return;
    const [companies] = await pool.query<any[]>(`SELECT DISTINCT company_id FROM company_opportunity_tracking`);
    for (const row of companies) await evaluateAlertsForCompany(Number(row.company_id));
  } catch (error) {
    console.warn(`[alert-worker] evaluación interrumpida; tipo=${error instanceof Error ? error.name : 'error'}`);
  } finally {
    if (locked && connection) await connection.query("SELECT RELEASE_LOCK('oportuna_alert_evaluation')");
    connection?.release();
    running = false;
  }
}

export function startAlertScheduler() {
  const config = loadRuntimeConfig();
  if (!['all','alert-worker'].includes(config.processRole) || !config.alertSchedulerEnabled || timer) return;
  timer = setInterval(() => void evaluateAllCompanies(), 5 * 60_000);
  void evaluateAllCompanies();
}
