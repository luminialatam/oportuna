import 'dotenv/config';
import pool from '../../server/src/db.js';
import { dailySchedulerStatus } from '../../server/src/syncService.js';

const host=process.env.DB_HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)){
  process.stderr.write('Unable to show status: configured database is not local.\n');
  process.exit(2);
}
try{
  const status=await dailySchedulerStatus();
  const [[job]]=await pool.query("SELECT estado,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') AS fechaInicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') AS fechaFin,dias_completados AS diasCompletados,total_dias AS totalDias,dias_fallidos AS diasFallidos FROM sync_jobs ORDER BY id DESC LIMIT 1");
  const next=status.nextRunAt?new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',dateStyle:'full',timeStyle:'short'}).format(new Date(status.nextRunAt)):'No programada';
  process.stdout.write(JSON.stringify({
    schedulerEnabled:status.enabled,
    timezone:status.timezone,
    scheduledTime:status.scheduledTime,
    nextRun:next,
    lastSuccessfulDate:status.lastSuccessfulDate,
    pendingDates:status.pendingDates,
    pendingDays:status.pendingDays,
    maxDaysPerJob:status.maxDaysPerJob,
    latestJob:job??null,
  },null,2)+'\n');
}catch{
  process.stderr.write('Unable to read sync scheduler status.\n');
  process.exitCode=1;
}finally{
  await pool.end();
  process.exit(process.exitCode??0);
}
