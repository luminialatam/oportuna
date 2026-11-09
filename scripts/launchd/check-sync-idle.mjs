import 'dotenv/config';
import pool from '../../server/src/db.js';

const host=process.env.DB_HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)){
  process.stderr.write('Refusing worker transition: configured database is not local.\n');
  process.exit(2);
}
try{
  const [rows]=await pool.query('SELECT COUNT(*) AS active FROM sync_jobs WHERE estado IN (\'queued\',\'running\',\'paused\')');
  process.stdout.write(`${Number(rows[0]?.active)||0}\n`);
}catch{
  process.stderr.write('Unable to verify local sync job state; worker transition refused.\n');
  process.exitCode=2;
}finally{
  await pool.end();
  process.exit(process.exitCode??0);
}
