import assert from 'node:assert/strict';
import { dailySyncPlan, isDailySchedulerDue, nextSantiagoRun } from '../src/syncService.js';

const wallTime = (value: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(value);
const wallDate = (value: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value);

const beforeEight = new Date('2026-11-08T10:59:00.000Z'); // 07:59 in Santiago (UTC-3).
const atEight = new Date('2026-11-08T11:00:00.000Z');
assert.equal(isDailySchedulerDue(beforeEight), false);
assert.equal(isDailySchedulerDue(atEight), true);
assert.equal(nextSantiagoRun(beforeEight).toISOString(), atEight.toISOString());
assert.equal(wallDate(nextSantiagoRun(atEight)), '2026-11-09');

const recovery = dailySyncPlan(new Date('2026-11-08T12:00:00.000Z'), '2026-11-02', 14, '2026-11-08');
assert.deepEqual(recovery, {
  dateFrom: '2026-11-03', dateTo: '2026-11-08', totalPendingDays: 6, refreshActive: true,
});
const bounded = dailySyncPlan(new Date('2026-11-08T12:00:00.000Z'), '2026-09-01', 14, '2026-11-08');
assert.deepEqual(bounded, {
  dateFrom: '2026-09-02', dateTo: '2026-09-15', totalPendingDays: 68, refreshActive: false,
});
const remainder = dailySyncPlan(new Date('2026-11-08T12:00:00.000Z'), bounded!.dateTo, 14, '2026-11-08');
assert.equal(remainder?.dateFrom, '2026-09-16');
assert.equal(remainder?.refreshActive, false);
assert.equal(dailySyncPlan(new Date('2026-11-08T12:00:00.000Z'), '2026-11-08', 14, '2026-11-08'), null);

// Chile's 2026 DST transitions: scheduler output must remain 08:00 local on either side.
for (const instant of [
  new Date('2026-09-06T03:30:00.000Z'),
  new Date('2026-09-06T04:30:00.000Z'),
  new Date('2026-04-05T02:30:00.000Z'),
  new Date('2026-04-05T04:30:00.000Z'),
]) {
  const next = nextSantiagoRun(instant);
  assert.ok(next.getTime() > instant.getTime(), 'next scheduled run must be in the future');
  assert.equal(wallTime(next), '08:00');
}

console.log('PASS scheduler unit: Santiago 08:00, DST transitions, catch-up planning, 14-day cap and completed-date idempotency.');
