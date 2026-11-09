import pool from '../src/db.js';

const lockName = process.env.LOCK_TEST_NAME ?? 'oportuna_test_lock';
const mode = process.env.LOCK_TEST_MODE ?? 'try';
const connection = await pool.getConnection();
let locked = false;
try {
  const [rows] = await connection.query<any[]>(`SELECT GET_LOCK(?,0) acquired`,[lockName]);
  locked = Number(rows[0]?.acquired) === 1;
  process.stdout.write(locked ? 'LOCKED\n' : 'BUSY\n');
  if (locked && mode === 'hold') {
    process.once('SIGTERM', async () => {
      await pool.end();
      process.exit(0);
    });
    await new Promise<void>(() => undefined);
  }
  if (locked) await connection.query('SELECT RELEASE_LOCK(?)',[lockName]);
} finally {
  connection.release();
  await pool.end();
}
