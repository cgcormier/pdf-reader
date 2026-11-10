import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

// Runner-local calibration allows scheduling noise without calling one laptop's
// milliseconds a universal target. Freeze this policy before measuring changes.
export const POLICY = Object.freeze({ version: 1, factor: 1.5, allowanceMs: 40, longTaskAllowanceMs: 50, samples: 3 });
export const hash = value => createHash('sha256').update(value).digest('hex');
export const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
export async function provenance(files, sourceRef) {
  const listSource = sourceRef ? ['ls-tree', '-r', '--name-only', sourceRef, '--', 'src']
    : ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src'];
  const sourceFiles = execFileSync('git', listSource, { encoding: 'utf8' }).trim().split(/\r?\n/).sort();
  const source = [];
  for (const file of sourceFiles) source.push([file, hash(sourceRef ? execFileSync('git', ['show', `${sourceRef}:${file}`]) : await readFile(file))]);
  const runner = [];
  for (const file of files) runner.push([file, hash(await readFile(file))]);
  return { commit: execFileSync('git', ['rev-parse', sourceRef || 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceRef: sourceRef || null, sourceHash: hash(JSON.stringify(source)), runnerHash: hash(JSON.stringify(runner)),
    sourceFiles: source, runnerFiles: runner, dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() };
}
export function environment() {
  return { platform: os.platform(), arch: os.arch(), release: os.release(), cpu: os.cpus()[0]?.model,
    cores: os.cpus().length, node: process.version, headless: true, channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome' };
}
// Runs in the page. Unsupported or failed observation is evidence, never zero work.
export function installLongTasks() {
  const state = window.auditPerformance = { supported: false, active: false, verified: false, entries: [], errors: [] };
  try {
    state.supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    if (!state.supported) return;
    const record = entries => state.entries.push(...entries.map(e => ({ start: e.startTime, duration: e.duration, name: e.name })));
    const observer = new PerformanceObserver(list => record(list.getEntries()));
    observer.observe({ type: 'longtask', buffered: true }); state.active = true;
    state.drain = () => record(observer.takeRecords());
  } catch (error) { state.errors.push(String(error)); }
}
export async function verifyLongTasks(page) {
  await page.evaluate(() => new Promise(resolve => setTimeout(() => {
    const end = performance.now() + 65; while (performance.now() < end) {}
    resolve();
  }, 0)));
  await page.waitForTimeout(80);
  return page.evaluate(() => {
    const state = window.auditPerformance; state.drain?.();
    state.verified = state.active && state.entries.some(e => e.duration >= 50);
    return { supported: state.supported, active: state.active, verified: state.verified, errors: state.errors,
      userAgent: navigator.userAgent, devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency };
  });
}
export function longTaskSummary(entries, start, end) {
  const overlapping = entries.filter(e => e.start < end && e.start + e.duration > start);
  return { longTaskCount: overlapping.length, longTaskTotalMs: overlapping.reduce((sum, e) => sum + e.duration, 0),
    longTaskMaxMs: Math.max(0, ...overlapping.map(e => e.duration)), longTasks: overlapping };
}
export const caseKey = row => JSON.stringify([row.name, row.width, row.textSize, row.motion, row.prepared]);
export const NAVIGATION_KEYS = ['animationStartMs', 'visibleMs', 'committedMs', 'preparationMs', 'animationMs', 'candidateMs', 'layoutMs', 'extractionMs', 'visibleInsertionMs', 'idlePreparationMs', 'longTaskTotalMs', 'longTaskMaxMs', 'idleLongTaskTotalMs', 'idleLongTaskMaxMs'];
export const FITTING_KEYS = ['elapsedMs', 'longTaskTotalMs', 'longTaskMaxMs'];
const fingerprint = report => JSON.stringify([report.kind, report.provenance.runnerHash, report.environment, report.capabilities]);
export function calibrate(report, keys, expectedCases) {
  assert.equal(report.errors.length, 0, 'baseline renderer errors');
  assert.ok(report.capabilities?.verified && report.capabilities.errors.length === 0, 'Long Tasks observer must be verified');
  assert.equal(report.rows.length, expectedCases * POLICY.samples, 'incomplete calibration matrix');
  const groups = new Map();
  for (const row of report.rows) { const key = caseKey(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  assert.equal(groups.size, expectedCases, 'incomplete calibration cases');
  const cases = [...groups].map(([key, rows]) => {
    assert.equal(rows.length, POLICY.samples, `${key}: sample count`);
    return { key, samples: rows.length, limits: Object.fromEntries(keys.map(metric => {
      const raw = rows.map(row => row[metric]);
      const values = metric === 'animationStartMs' ? raw.filter(value => value !== null) : raw;
      if (metric === 'animationStartMs' && values.length === 0) return [metric, null];
      assert.ok(values.every(Number.isFinite), `${key}: missing ${metric}`);
      const observedMax = Math.max(...values);
      return [metric, { observedMax, max: observedMax * POLICY.factor + (metric.includes('LongTask') || metric.startsWith('longTask') ? POLICY.longTaskAllowanceMs : POLICY.allowanceMs) }];
    })) };
  });
  return { policy: POLICY, created: new Date().toISOString(), baseline: { started: report.started, provenance: report.provenance }, fingerprint: fingerprint(report), cases };
}
export async function evaluateGate(report, keys, expectedCases, { calibrationPath, budgetPath }) {
  assert.ok(!(calibrationPath && budgetPath), 'choose calibration or evaluation');
  if (calibrationPath) {
    const budget = calibrate(report, keys, expectedCases);
    // Existing budgets cannot be overwritten after seeing a candidate.
    await writeFile(calibrationPath, JSON.stringify(budget, null, 2), { flag: 'wx' });
    return { status: 'calibrated', path: calibrationPath, policy: POLICY };
  }
  assert.ok(budgetPath, 'Timing gate requires --budget=PATH; create it first with --calibrate=PATH --source-ref=BASELINE');
  const budget = JSON.parse(await readFile(budgetPath, 'utf8'));
  assert.deepEqual(budget.policy, POLICY, 'calibration policy mismatch');
  assert.ok(Date.parse(budget.created) < Date.parse(report.started), 'calibration must predate candidate execution');
  assert.equal(budget.fingerprint, fingerprint(report), 'runner/environment/capability mismatch; use the baseline runner environment');
  const observed = calibrate(report, keys, expectedCases);
  assert.deepEqual(observed.cases.map(c => c.key), budget.cases.map(c => c.key), 'candidate case matrix mismatch');
  const failures = [];
  for (const entry of observed.cases) {
    const limits = budget.cases.find(c => c.key === entry.key).limits;
    for (const metric of keys) {
      const value = entry.limits[metric]?.observedMax; const limit = limits[metric]?.max;
      if (entry.limits[metric] === null && limits[metric] === null) continue;
      if (!Number.isFinite(value) || !Number.isFinite(limit) || value > limit) failures.push({ case: entry.key, metric, observed: value, limit });
    }
  }
  return { status: failures.length ? 'failed' : 'passed', path: budgetPath, policy: POLICY, failures };
}
export function assertNavigationBounds(rows) {
  for (const row of rows) {
    assert.ok(row.anchor && Number.isFinite(row.committedMs) && Number.isFinite(row.visibleMs), 'missing observable turn result');
    if (row.motion === 'no-preference' && !row.events.find(e => e.type === 'turn-ready')?.fallback) {
      assert.ok(Number.isFinite(row.animationStartMs), `${caseKey(row)}: normal turn did not animate`);
    }
    assert.ok(row.probes <= 128 && row.layoutReads <= 512, `${caseKey(row)}: ordinary fitting work exceeded bound`);
    if (row.prepared) assert.equal(row.probes, 0, `${caseKey(row)}: prepared turn performed fitting`);
    assert.ok(row.committedMs < 1000, `${caseKey(row)}: interaction exceeded one second`);
  }
}
