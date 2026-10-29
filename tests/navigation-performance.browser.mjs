/** Production navigation measurements on an isolated origin.
 * node tests/navigation-performance.browser.mjs metrics [--baseline] [--original-fitting]
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { makeFidelityPdf } from './fidelity-fixtures.mjs';

const baseline = process.argv.includes('--baseline');
const selection = 'metrics';
assert.ok(process.argv.slice(2).every(arg => ['metrics', '--baseline', '--original-fitting'].includes(arg)), 'Only metrics is implemented in this batch');
await mkdir('output/playwright/navigation-performance', { recursive: true });
const run = await mkdtemp('output/playwright/navigation-performance/run-');
// Isolate #18's animation comparison while the fitting lane is developed.
const originalFitting = process.argv.includes('--original-fitting');
const originalModules = originalFitting ? new Map(['book-pagination.js', 'layout-reading.js'].map(file =>
  [path.resolve('src', file).replaceAll('\\', '/'), execFileSync('git', ['show', `7668a92:src/${file}`], { encoding: 'utf8' })])) : new Map();
for (const file of ['main.js', 'page-turn.js']) {
  let code = await readFile(`src/${file}`, 'utf8');
  if (baseline && originalFitting) code = file === 'page-turn.js' ? code.replace('duration = 160', 'duration = 420') : code.replace('.matches || fallback', '.matches');
  originalModules.set(path.resolve('src', file).replaceAll('\\', '/'), code);
}
const server = await createServer({ cacheDir: `${run}/vite-cache`, plugins: [{ name: 'audit-original-fitting', enforce: 'pre', load: id => originalModules.get(id) }],
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, clearScreen: false });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { baseline, originalFitting, environment: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version }, metrics: [], input: [], errors: [] };
let context;
async function settled(page) {
  await page.waitForFunction(() => !document.querySelector('#modal').open && (document.body.classList.contains('scroll-mode')
    ? document.querySelector('#scroll-stage').dataset.activeLoads === '0'
    : document.querySelector('#book-spread').getAttribute('aria-busy') === 'false'
      && Boolean(document.querySelector('#book-spread > .paper-page .page-prose'))));
}
async function importPdf(page, name, bytes) {
  await page.locator('#file-input').setInputFiles({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: bytes });
  await page.waitForFunction(async filename => {
    const { getBook } = await import('/src/storage.js');
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    if (!id || id === 'demo') return false;
    const b = await getBook(id);
    return !document.querySelector('#modal').open && b?.filename === filename && b.structure?.status === 'complete';
  }, `${name}.pdf`, { timeout: 90000 });
  await page.locator('#book-view').click(); await page.locator('#pages-layout').click(); await settled(page);
}
async function jump(page, number = 1) {
  await page.locator('#page-input').fill(String(number)); await page.locator('#page-input').press('Enter');
  await page.locator('#page-input').blur(); await settled(page);
}
async function size(page, width, value) {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 }); await pause(220);
  await page.locator('#appearance-button').press('Home');
  for (let n = 6; n < value; n++) await page.locator('#appearance-button').press('ArrowRight');
  await page.locator('#appearance-button').blur(); await pause(220); await settled(page);
}
async function rawClick(page, id) {
  const box = await page.locator(`#${id}`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
async function clear(page) { await page.evaluate(() => { window.auditEvents = []; }); }
async function warm(page) {
  await page.evaluate(async () => {
    const callback = window.auditIdle; window.auditIdle = null;
    if (callback) await callback({ didTimeout: true, timeRemaining: () => 0 });
  });
}
async function turnMetric(page) {
  await clear(page);
  await rawClick(page, 'next-page'); await settled(page); await pause(35);
  return page.evaluate(() => {
    const events = window.auditEvents;
    const input = events.find(e => e.type === 'turn-input');
    const commit = events.find(e => e.type === 'turn-commit');
    const visible = events.find(e => e.type === 'paint-visible');
    const probes = events.filter(e => e.type === 'fit-probe');
    const sum = (items, key) => items.reduce((n, e) => n + (e[key] || 0), 0);
    return { events, probes: probes.length, candidateReconstructions: probes.length, layoutReads: sum(probes, 'reads'),
      candidateMs: sum(probes, 'construction'), layoutMs: sum(probes, 'layout'),
      extractionMs: sum(events.filter(e => e.type === 'extraction'), 'duration'),
      preparationMs: events.find(e => e.type === 'turn-ready')?.preparation,
      animationMs: events.find(e => e.type === 'turn-animation')?.duration,
      visibleInsertionMs: sum(events.filter(e => e.type === 'visible-insertion'), 'duration'),
      visibleMs: visible && input ? visible.time - input.time : null,
      committedMs: commit && input ? commit.time - input.time : null,
      anchor: commit && { page: commit.page, offset: commit.offset } };
  });
}
const textPages = Array.from({ length: 10 }, (_, p) => ({ items: Array.from({ length: 45 }, (_, line) => ({
  text: `Source ${p + 1}, line ${line + 1} carries exact words along the quiet road.`, x: 40, y: 750 - line * 14,
})) }));
const fixtures = [
  ['text', makeFidelityPdf(textPages)],
  ['mixed', makeFidelityPdf(textPages.map(p => ({ items: p.items.map((item, i) => ({ ...item, bold: i % 3 === 0, italic: i % 3 === 1 })) })))],
  ['verse', makeFidelityPdf(textPages.map((p, n) => ({ items: [
    { text: n % 2 ? 'MESSENGER' : 'TRAVELLER', x: 40, y: 750 },
    ...p.items.map((item, i) => ({ ...item, x: 110, y: 750 - i * 14 })),
    { text: '[They leave together.]', x: 150, y: 100, italic: true },
  ] })))],
  ['fallback', makeFidelityPdf([{ items: [{ text: 'A text opening keeps Book view available.', y: 700 }] }, ...Array.from({ length: 8 }, (_, i) => i % 2 ? { image: true } : { items: [] })])],
];
async function metrics(page) {
  for (const [name, bytes] of fixtures) {
    await importPdf(page, name, bytes);
    for (const width of [1440, 390]) for (const textSize of [13, 19]) {
      await size(page, width, textSize);
      for (const motion of ['no-preference', 'reduce']) {
        await page.emulateMedia({ reducedMotion: motion });
        for (const prepared of [false, true]) {
          await jump(page);
          for (let repeat = 0; repeat < 3; repeat++) {
            if (await page.locator('#next-page').isDisabled()) await jump(page);
            if (prepared) await warm(page);
            const metric = await turnMetric(page);
            assert.ok(metric.anchor, `${name}: no completed turn`);
            report.metrics.push({ name, width, textSize, motion, prepared, repeat, ...metric });
          }
          await page.screenshot({ path: `${run}/${name}-${width}-${textSize}-${motion}-${prepared}.png` });
        }
      }
    }
  }
}

try {
  await server.listen();
  context = await chromium.launchPersistentContext(`${run}/profile`, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 } });
  report.environment.browser = context.browser()?.version();
  await context.addInitScript(() => {
    window.auditEvents = []; window.auditIdle = null;
    window.requestIdleCallback = callback => { window.auditIdle = callback; return 1; };
    window.cancelIdleCallback = () => { window.auditIdle = null; };
    window.__folioReaderMetric = event => {
      window.auditEvents.push(event);
      if (event.type !== 'turn-start') return;
      let sawVisible = false;
      const inspect = () => {
        const stage = document.querySelector('#book-spread');
        const layer = stage.querySelector('.page-turn-layer');
        const ready = window.auditEvents.findLast(e => e.type === 'turn-ready');
        const committed = window.auditEvents.findLast(e => e.type === 'turn-commit');
        // Require destination prose to have a nontrivial projected width on the
        // visible back face. This conservative paint opportunity avoids counting
        // an exposed blank paper margin as destination text.
        const anim = layer?.querySelector('.page-turn-leaf')?.getAnimations()[0];
        const progress = anim?.effect?.getComputedTiming().progress;
        const prose = layer?.querySelector('.page-turn-back .page-prose');
        const projected = prose?.getBoundingClientRect().width || 0;
        if (ready && ready.time >= event.time && (layer && progress > .5 && projected >= 40
          || committed && committed.time >= event.time)) {
          window.auditEvents.push({ type: 'paint-visible', time: performance.now() }); sawVisible = true;
        }
        if (!sawVisible && stage.getAttribute('aria-busy') === 'true') requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    };
    // Deep clones are forbidden on the navigation path, even for styled leaves.
    const clone = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function (deep) {
      if (deep && this.nodeType === 1 && (this.matches?.('.paper-page, .page-prose') || this.closest?.('.paper-page'))) throw new Error('Reader deep clone');
      return clone.call(this, deep);
    };
  });
  const page = context.pages()[0]; page.on('pageerror', error => report.errors.push(error.message));
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  assert.notEqual(server.httpServer.address().port, 4173);
  console.log(`Isolated origin ${origin}; ${run}`);
  await page.goto(`${origin}/tests/fidelity-check.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('demo')));
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#appearance-button[role="slider"]').waitFor({ timeout: 90000 }); await settled(page);
  if (selection !== 'input') await metrics(page);
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${selection}${baseline ? ' baseline diagnostic' : ''}; evidence: ${run}`);
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${run}/report.json`, JSON.stringify(report, null, 2)); await context?.close(); await server.close(); }
