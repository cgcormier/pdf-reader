/** DOM fitting gate: --calibrate=PATH --source-ref=BASELINE, then --budget=PATH. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { option, provenance, environment, installLongTasks, verifyLongTasks, evaluateGate, FITTING_KEYS } from './performance-gate.mjs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'output', 'playwright', 'fitting-performance');
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(path.join(artifacts, 'run-'));
const baseline = process.argv.includes('--baseline');
const started = new Date().toISOString();
const sourceRef = option('source-ref'); const calibrationPath = option('calibrate'); const budgetPath = option('budget');
assert.ok(!calibrationPath || sourceRef, 'Calibration requires an explicit --source-ref=COMMIT');
assert.ok(!sourceRef || calibrationPath && !baseline, '--source-ref is reserved for baseline calibration');
const modules = new Map();
if (sourceRef) for (const file of execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' }).trim().split(/\r?\n/)) {
  modules.set(path.resolve(file).replaceAll('\\', '/'), execFileSync('git', ['show', `${sourceRef}:${file}`], { encoding: 'utf8' }));
}
const server = await createServer({ root, plugins: [{ name: 'frozen-baseline', enforce: 'pre', load: id => modules.get(id) }], cacheDir: path.join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, clearScreen: false });
const errors = []; const report = { kind: 'fitting', started, baseline, status: 'failed', cases: [], errors, environment: environment(),
  provenance: await provenance(['tests/fitting-performance.browser.mjs', 'tests/performance-gate.mjs', 'package-lock.json'], sourceRef) };
let browser; let page; let repeat = 0;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(typeof address === 'object' && address.port !== 4173);
  browser = await chromium.launch({ channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome', headless: true });
  report.environment.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(installLongTasks);
  await page.goto(`http://127.0.0.1:${address.port}/tests/fidelity-check.html`);
  report.capabilities = await verifyLongTasks(page);
  assert.ok(report.capabilities.verified, 'Long Tasks observation unavailable or self-test failed');
  for (repeat = 0; repeat < 3; repeat++) {
  const cases = await page.evaluate(async () => {
    await import('/src/styles.css');
    const { paginateText } = await import('/src/book-pagination.js');
    const { paginateLayout, renderLayout } = await import('/src/layout-reading.js');
    const { sourceAt, offsetForSource } = await import('/src/pdf-layout.js');
    await document.fonts.ready;
    document.documentElement.style.setProperty('--reading-size', '13px');
    document.body.replaceChildren();
    const results = window.auditFittingResults = [];
    const paragraph = text => model(text, [{ id: 'body', role: 'paragraph', start: 0, end: text.length, lines: [] }]);
    function model(text, blocks) {
      return { bodySize: 13, regions: [{ id: 'body', x: 0 }], blocks,
        projection: { text, segments: [{ start: 0, end: text.length, source: { item: 0, start: 0, end: text.length } }],
          emphasis: [] } };
    }
    function measurement(layout, { height = 700, continuationHeight = height, width = 660 } = {}) {
      const host = document.createElement('div'); host.className = 'book-measure';
      host.style.width = `${width}px`; host.style.height = `${height}px`;
      const leaves = [height, continuationHeight].map(value => {
        const leaf = document.createElement('section'); leaf.className = 'paper-page'; leaf.style.height = `${value}px`;
        const prose = document.createElement('div'); prose.className = 'page-prose'; leaf.append(prose); host.append(leaf); return prose;
      });
      document.body.append(host);
      const probes = [];
      const fits = (text, { start, end }) => {
        const began = performance.now(); const prose = leaves[start === 0 ? 0 : 1];
        prose.replaceChildren(); renderLayout(prose, layout, { start, end });
        const rendered = performance.now(); const last = prose.lastElementChild;
        const scrollHeight = prose.scrollHeight; const clientHeight = prose.clientHeight;
        const bottom = last?.getBoundingClientRect().bottom ?? 0; const limit = prose.getBoundingClientRect().bottom - 1;
        const result = scrollHeight <= clientHeight && (!last || bottom <= limit);
        probes.push({ start, end, fits: result, constructionMs: rendered - began, layoutMs: performance.now() - rendered });
        return result;
      };
      return { host, fits, probes, remove: () => host.remove() };
    }
    async function run(name, layout, geometry = {}) {
      const measured = measurement(layout, geometry); const began = performance.now();
      const fragments = paginateLayout(layout, measured.fits); const elapsedMs = performance.now() - began;
      const fittingProbes = measured.probes.slice();
      const fits = fragments.map(fragment => measured.fits(fragment.text, fragment));
      const sourceRoundtrips = fragments.flatMap(fragment => [fragment.start, fragment.end - 1])
        .filter(offset => offset >= 0 && offset < layout.projection.text.length)
        .every(offset => offsetForSource(layout.projection, sourceAt(layout.projection, offset)) === offset);
      const coverage = fragments.every((fragment, index) => fragment.start === (index ? fragments[index - 1].end : 0)
        && fragment.text === layout.projection.text.slice(fragment.start, fragment.end))
        && fragments.at(-1).end === layout.projection.text.length;
      const safeUnicode = fragments.every(fragment => !/[\uD800-\uDBFF]$/u.test(fragment.text) && !/^[\uDC00-\uDFFF]/u.test(fragment.text));
      const keys = fittingProbes.map(probe => `${probe.start}:${probe.end}`);
      const speakerOrphans = fragments.slice(0, -1).filter(fragment => {
        const block = layout.blocks.findLast(block => block.speaker && block.start > fragment.start && block.start < fragment.end);
        return block && layout.projection.text.slice(block.start, fragment.end).trim().length <= block.speaker.length;
      }).length;
      const entry = { name, characters: layout.projection.text.length, elapsedMs, geometry,
        intervals: fragments.map(({ start, end, kind }) => ({ start, end, kind })), probes: fittingProbes,
        duplicateProbes: keys.length - new Set(keys).size, fits, sourceRoundtrips, coverage, safeUnicode, speakerOrphans };
      const end = performance.now();
      await new Promise(resolve => setTimeout(resolve, 60));
      window.auditPerformance.drain?.();
      const tasks = window.auditPerformance.entries.filter(e => e.start < end && e.start + e.duration > began);
      Object.assign(entry, { longTaskCount: tasks.length, longTaskTotalMs: tasks.reduce((sum, e) => sum + e.duration, 0),
        longTaskMaxMs: Math.max(0, ...tasks.map(e => e.duration)), longTasks: tasks });
      results.push(entry); measured.remove(); return entry;
    }
    const prose = 'Measured source words remain intact. '.repeat(120);
    await run('dense-paragraph', paragraph(prose.repeat(5)));
    await run('narrow-paragraph', paragraph(prose), { width: 370, height: 620 });
    // Calibrate against real font metrics so the fixture starts with a sparse terminal leaf.
    const calibration = measurement(paragraph('x '.repeat(3000)));
    const capacity = paginateText('x '.repeat(3000), calibration.fits)[0].end; calibration.remove();
    const tailText = 'x '.repeat(capacity / 2) + 'A short ending.';
    const tail = await run('balanced-tail', paragraph(tailText));
    tail.originalSplit = capacity;
    const opening = 'A source paragraph has measured words. '.repeat(12);
    const speakerStart = opening.length + 2; const replyStart = speakerStart + 7;
    const speechText = `${opening}\n\nGUIDE\n\nKeep these measured source words together. ` + 'A continued reply. '.repeat(35);
    const speechModel = model(speechText, [
      { id: 'opening', role: 'paragraph', start: 0, end: opening.length, lines: [] },
      { id: 'speaker', role: 'speech', speaker: 'GUIDE', association: 'guide', regionId: 'body',
        start: speakerStart, end: speakerStart + 5, lines: [{ start: speakerStart, end: speakerStart + 5, x: 0 }] },
      { id: 'reply', role: 'line-group', association: 'guide', regionId: 'body', start: replyStart, end: speechText.length,
        lines: [{ start: replyStart, end: speechText.length, x: 0 }] },
    ]);
    let speakerHeight = 100;
    for (; speakerHeight < 700; speakerHeight++) {
      const probe = measurement(speechModel, { height: speakerHeight });
      const fitsLabel = probe.fits(speechText.slice(0, replyStart), { start: 0, end: replyStart }); probe.remove();
      if (fitsLabel) break;
    }
    const speechGreedy = measurement(speechModel, { height: speakerHeight });
    const greedySpeech = paginateText(speechText, speechGreedy.fits); speechGreedy.remove();
    const repaired = await run('speaker-repair', speechModel, { height: speakerHeight });
    repaired.greedyOrphan = greedySpeech.some(fragment => fragment.start < speakerStart
      && fragment.end > speakerStart && speechText.slice(speakerStart, fragment.end).trim() === 'GUIDE');
    const lines = Array.from({ length: 90 }, (_, index) => `Line ${index} preserves its source boundary.`);
    let offset = 0;
    const blocks = lines.map((line, index) => {
      const start = offset; offset += line.length + (index === lines.length - 1 ? 0 : 1);
      return { id: `line-${index}`, role: index % 9 === 0 ? 'speech' : 'line-group',
        ...(index % 9 === 0 ? { speaker: 'Line', association: `speech-${index}` } : {}),
        start, end: start + line.length, regionId: 'body', continuesToNext: index % 9 !== 8,
        lines: [{ start, end: start + line.length, x: index % 3 * 5 }] };
    });
    await run('preserved-speaker-lines', model(lines.join('\n'), blocks), { width: 370, height: 620 });
    // A one-line continuation is deliberately asymmetric. It reproduces an exact
    // failed final-pair search without assuming suffix fitting is monotonic.
    const oneLineHeight = 36 + 22 + 26;
    const asymmetry = measurement(paragraph('z'.repeat(300)), { continuationHeight: oneLineHeight });
    let finalLength = 1;
    while (finalLength < 300 && asymmetry.fits('z'.repeat(finalLength + 1), { start: 1, end: finalLength + 2 })) finalLength++;
    asymmetry.remove();
    const failureText = 'x '.repeat(capacity / 2) + 'z'.repeat(finalLength);
    const failed = await run('unsuccessful-final-pair', paragraph(failureText), { continuationHeight: oneLineHeight });
    failed.originalSplit = capacity;
    await run('oversized-glyph', paragraph('\u{1f600}'), { height: 60 });
    // Expose retained production rendering for screenshot inspection.
    const preview = document.createElement('section'); preview.className = 'paper-page';
    preview.style.cssText = 'width:660px;height:700px;margin:20px';
    const previewProse = document.createElement('div'); previewProse.className = 'page-prose'; preview.append(previewProse);
    renderLayout(previewProse, model(lines.join('\n'), blocks), { end: results.find(entry => entry.name === 'preserved-speaker-lines').intervals[0].end }); document.body.append(preview);
    return results;
  });
  report.cases.push(...cases.map(entry => ({ ...entry, repeat })));
  }
  for (const entry of report.cases) {
    assert.ok(entry.coverage && entry.safeUnicode && entry.sourceRoundtrips, `${entry.name}: source coverage`);
    assert.equal(entry.speakerOrphans, 0, `${entry.name}: orphaned speaker`);
    if (entry.name === 'oversized-glyph') {
      assert.deepEqual(entry.fits, [false], 'oversized glyph must be measured as overflow');
      assert.deepEqual(entry.intervals, [{ start: 0, end: 2, kind: 'overflow' }]);
    } else {
      assert.ok(entry.fits.every(Boolean), `${entry.name}: final DOM overflow`);
      assert.ok(entry.intervals.every(fragment => fragment.kind === 'layout'), `${entry.name}: incorrect overflow classification`);
    }
    if (!baseline) assert.equal(entry.duplicateProbes, 0, `${entry.name}: redundant exact range measurements`);
    assert.ok(entry.probes.length <= (entry.name === 'unsuccessful-final-pair' ? 1800 : 64), `${entry.name}: fitting work exceeded bound`);
  }
  const balanced = report.cases.find(entry => entry.name === 'balanced-tail');
  assert.equal(balanced.intervals.length, 2);
  assert.ok(balanced.intervals[0].end < balanced.originalSplit, 'sparse terminal pair did not rebalance');
  const failed = report.cases.find(entry => entry.name === 'unsuccessful-final-pair');
  assert.equal(failed.intervals.length, 2);
  assert.equal(failed.intervals[0].end, failed.originalSplit, 'failed pair changed its exact original split');
  assert.ok(failed.probes.filter(probe => !probe.fits && probe.start > 0).length > 10, 'failed pair search was not exercised');
  assert.equal(report.cases.find(entry => entry.name === 'speaker-repair').greedyOrphan, true, 'speaker repair was not exercised');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, 'preserved-source-lines.png'), fullPage: true });
  if (!baseline) {
    report.rows = report.cases;
    report.gate = await evaluateGate(report, FITTING_KEYS, 7, { calibrationPath, budgetPath });
    assert.equal(report.gate.status === 'failed', false, JSON.stringify(report.gate.failures));
  }
  report.status = baseline ? 'baseline-diagnostic' : 'passed';
  console.log(report.cases.map(entry => `${entry.name}: ${entry.probes.length} probes, ${entry.duplicateProbes} duplicates, ${entry.elapsedMs.toFixed(1)}ms`).join('\n'));
  console.log(`Evidence retained: ${directory}`);
} catch (error) {
  const partial = await page?.evaluate(() => window.auditFittingResults || []).catch(() => []);
  report.partialCases = repeat < 3 ? partial?.map(entry => ({ ...entry, repeat })) : [];
  report.failure = error.stack; throw error;
} finally {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
