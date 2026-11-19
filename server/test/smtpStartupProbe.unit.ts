import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSmtpStartupProbe } from '../src/smtpStartupProbe.js';

const productionWithProbe = {
  APP_ENV: 'production',
  SMTP_STARTUP_PROBE_ONCE: 'true',
} as NodeJS.ProcessEnv;

{
  let probeCalls = 0;
  const logs: string[] = [];
  const run = createSmtpStartupProbe(async () => { probeCalls += 1; }, {
    info: (line) => logs.push(line), error: (line) => logs.push(line),
  });
  run({ APP_ENV: 'production' } as NodeJS.ProcessEnv);
  run({ APP_ENV: 'development', SMTP_STARTUP_PROBE_ONCE: 'true' } as NodeJS.ProcessEnv);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(probeCalls, 0, 'the check is off by default and restricted to production');
  assert.deepEqual(logs, []);
}

{
  let probeCalls = 0;
  const logs: string[] = [];
  const run = createSmtpStartupProbe(async () => { probeCalls += 1; }, {
    info: (line) => logs.push(line), error: (line) => logs.push(line),
  });
  run(productionWithProbe);
  run(productionWithProbe);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(probeCalls, 1, 'the enabled check runs once per process');
  assert.deepEqual(logs, ['[email] startup_smtp_probe result=success']);
}

{
  const logs: string[] = [];
  const run = createSmtpStartupProbe(async () => {
    throw new Error('SMTP_535 rejected user=private@example.invalid password=never-log-this');
  }, {
    info: (line) => logs.push(line), error: (line) => logs.push(line),
  });
  run(productionWithProbe);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(logs, ['[email] startup_smtp_probe result=failed code=SMTP_DELIVERY_FAILED']);
  assert.doesNotMatch(logs.join('\n'), /private@example\.invalid|never-log-this|535/);
}

{
  const logs: string[] = [];
  const run = createSmtpStartupProbe(async () => { throw new Error('SMTP_535'); }, {
    info: (line) => logs.push(line), error: (line) => logs.push(line),
  });
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      run(productionWithProbe);
      resolve();
    });
  });
  assert.equal(server.listening, true, 'the HTTP listener is active before the check starts');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(server.listening, true, 'an SMTP failure does not stop the HTTP listener');
  assert.deepEqual(logs, ['[email] startup_smtp_probe result=failed code=SMTP_5xx']);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log('PASS: startup SMTP probe apagado por defecto, único, sanitizado y no bloqueante.');
