import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calibrate, evaluateGate, longTaskSummary, assertNavigationBounds, POLICY } from './performance-gate.mjs';

function report(overrides = {}) {
  return { kind: 'test', started: '2026-01-01T00:00:00.000Z', provenance: { runnerHash: 'runner', sourceHash: 'baseline' },
    environment: { platform: 'test', cpu: 'test', browser: 'test' }, capabilities: { verified: true, errors: [] }, errors: [],
    rows: Array.from({ length: 3 }, (_, repeat) => ({ name: 'dense', repeat, committedMs: 180, longTaskTotalMs: 0 })), ...overrides };
}
const keys = ['committedMs', 'longTaskTotalMs'];
async function budgetFor(baseline = report()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'folio-performance-gate-'));
  const file = path.join(directory, 'budget.json');
  const budget = calibrate(baseline, keys, 1);
  budget.created = '2026-01-01T00:00:01.000Z';
  await writeFile(file, JSON.stringify(budget)); return file;
}
const candidate = overrides => report({ started: '2026-01-01T00:00:02.000Z', ...overrides });
test('runner-local calibration has a fixed scheduling allowance and bounded relative margin', () => {
  const budget = calibrate(report(), keys, 1);
  assert.equal(budget.cases[0].limits.committedMs.max, 180 * POLICY.factor + POLICY.allowanceMs);
  assert.equal(budget.cases[0].limits.longTaskTotalMs.max, POLICY.longTaskAllowanceMs);
});
test('gate accepts baseline-equivalent results and rejects fixed half-second waiting', async () => {
  const budgetPath = await budgetFor();
  assert.equal((await evaluateGate(candidate(), keys, 1, { budgetPath })).status, 'passed');
  const slower = candidate(); slower.rows[1].committedMs = 500;
  const result = await evaluateGate(slower, keys, 1, { budgetPath });
  assert.equal(result.status, 'failed'); assert.equal(result.failures[0].metric, 'committedMs');
});
test('long-task regression fails independently of commit timing', async () => {
  const budgetPath = await budgetFor(); const blocked = candidate(); blocked.rows[0].longTaskTotalMs = 80;
  const result = await evaluateGate(blocked, keys, 1, { budgetPath });
  assert.equal(result.status, 'failed'); assert.equal(result.failures[0].metric, 'longTaskTotalMs');
});
test('unsupported observation and incomplete samples cannot produce a budget', () => {
  assert.throws(() => calibrate(report({ capabilities: { verified: false, errors: [] } }), keys, 1), /observer/);
  const partial = report(); partial.rows.pop();
  assert.throws(() => calibrate(partial, keys, 1), /incomplete/);
});
test('incompatible environment and a budget created after candidate start are rejected', async () => {
  const budgetPath = await budgetFor();
  await assert.rejects(evaluateGate(candidate({ environment: { cpu: 'different' } }), keys, 1, { budgetPath }), /mismatch/);
  await assert.rejects(evaluateGate(report(), keys, 1, { budgetPath }), /predate/);
});
test('calibration cannot overwrite an existing budget', async () => {
  const calibrationPath = await budgetFor();
  await assert.rejects(evaluateGate(report(), keys, 1, { calibrationPath }), /EEXIST/);
});
test('task attribution includes tasks spanning the window and excludes adjacent tasks', () => {
  const entries = [{ start: 0, duration: 70 }, { start: 80, duration: 60 }, { start: 140, duration: 50 }];
  assert.deepEqual(longTaskSummary(entries, 60, 140), { longTaskCount: 2, longTaskTotalMs: 130, longTaskMaxMs: 70, longTasks: entries.slice(0, 2) });
});
test('prepared work and missing normal animation fail deterministic bounds', () => {
  const row = { name: 'dense', prepared: true, anchor: {}, committedMs: 170, visibleMs: 40, probes: 1, layoutReads: 4, events: [] };
  assert.throws(() => assertNavigationBounds([row]), /prepared turn/);
  assert.throws(() => assertNavigationBounds([{ ...row, probes: 0, motion: 'no-preference' }]), /did not animate/);
});
