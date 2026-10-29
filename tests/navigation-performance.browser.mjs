/** Production navigation measurements and input regressions on an isolated origin.
 * node tests/navigation-performance.browser.mjs [metrics|input|all] [--baseline]
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
const selection = process.argv.find(arg => ['metrics', 'input', 'all'].includes(arg)) || 'all';
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
async function stored(page) {
  return page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    return getBook(JSON.parse(localStorage.getItem('folio:active-book')));
  });
}
async function reloadBook(page) {
  const book = await stored(page);
  await page.reload();
  // Startup briefly renders the demo before reopening the saved PDF/layout.
  await page.waitForFunction(title => document.querySelector('#book-type').textContent === 'FROM YOUR SHELF'
    && document.querySelector('#book-title').textContent === title && !document.querySelector('#modal').open, book.title);
  await settled(page);
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
async function visibleText(page) {
  return page.locator('#book-spread > .paper-page').evaluateAll(leaves => leaves.map(leaf => ({
    page: leaf.dataset.sourcePage, start: leaf.dataset.textOffset, end: leaf.dataset.textEnd,
    text: leaf.querySelector('.page-prose')?.textContent,
  })));
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
async function input(page) {
  await importPdf(page, 'rapid-source', fixtures[0][1]);
  for (const [width, textSize] of [[1440, 13], [390, 19]]) {
  await size(page, width, textSize);
  for (const motion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: motion });
    // Record sequential reference anchors using the actual production pager.
    await jump(page); const anchors = [(await stored(page)).bookPosition]; const text = [await visibleText(page)];
    for (let i = 0; i < 3; i++) { await rawClick(page, 'next-page'); await settled(page); anchors.push((await stored(page)).bookPosition); text.push(await visibleText(page)); }
    await jump(page); await clear(page);
    await rawClick(page, 'next-page'); await rawClick(page, 'next-page');
    await settled(page); await pause(80); await settled(page);
    let book = await stored(page);
    assert.deepEqual(book.bookPosition, anchors[2], 'two discrete clicks must complete two ordered turns');
    assert.deepEqual(await visibleText(page), text[2], 'rapid mouse source text skipped or duplicated');
    const mouseEvents = await page.evaluate(() => window.auditEvents);
    await reloadBook(page);
    assert.deepEqual((await stored(page)).bookPosition, anchors[2], 'burst persisted/reloaded anchor');
    await jump(page); await clear(page);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await settled(page); await pause(80); await settled(page);
    assert.deepEqual((await stored(page)).bookPosition, anchors[2], 'two discrete real key presses');
    assert.deepEqual(await visibleText(page), text[2], 'rapid keyboard source text skipped or duplicated');
    const keyboardEvents = await page.evaluate(() => window.auditEvents);
    await jump(page); await clear(page); await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 20; i++) await page.keyboard.down('ArrowRight');
    await settled(page);
    for (let i = 0; i < 5; i++) await page.keyboard.down('ArrowRight');
    await page.keyboard.up('ArrowRight'); await settled(page); await pause(80); await settled(page);
    assert.deepEqual((await stored(page)).bookPosition, anchors[1], 'held repeat must not build a queue');
    report.input.push({ width, textSize, motion, anchors, mouseEvents, keyboardEvents, heldEvents: await page.evaluate(() => window.auditEvents), passed: true });
  }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  async function heldTurn() {
    await jump(page); await clear(page);
    await page.evaluate(() => { window.auditHold = true; window.auditAnimations = []; });
    await rawClick(page, 'next-page');
    await page.waitForFunction(() => window.auditAnimations.length > 0);
  }
  async function release() {
    await page.evaluate(() => { window.auditHold = false; for (const animation of window.auditAnimations) animation.finish(); });
    await settled(page); await pause(80); await settled(page);
  }
  await heldTurn();
  for (let i = 0; i < 8; i++) await rawClick(page, 'next-page');
  await page.evaluate(() => { window.auditAnimations[0].currentTime = 55; });
  await page.screenshot({ path: `${run}/held-turn-with-pending.png` });
  await release();
  const saturated = (await stored(page)).bookPosition;
  await jump(page); await rawClick(page, 'next-page'); await settled(page); await rawClick(page, 'next-page'); await settled(page);
  assert.deepEqual((await stored(page)).bookPosition, saturated, 'burst saturation is one active plus one pending turn');
  await heldTurn(); await rawClick(page, 'previous-page'); await release();
  assert.equal((await stored(page)).bookPosition.offset, 0, 'opposite pending direction returns to the original anchor');
  await heldTurn(); await rawClick(page, 'previous-page'); await rawClick(page, 'next-page'); await release();
  assert.deepEqual((await stored(page)).bookPosition, saturated, 'last pending direction wins');
  const cdp = await page.context().newCDPSession(page);
  async function swipe(pointer) {
    const box = await page.locator('#book-spread').boundingBox();
    const x = box.x + box.width * .8; const y = box.y + 12; const end = x - 140;
    if (pointer === 'touch') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end, y, button: 'left', buttons: 1, pointerType: 'pen' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', clickCount: 1, pointerType: 'pen' });
    }
  }
  for (const pointer of ['touch', 'pen']) {
    await heldTurn(); await swipe(pointer); await release();
    assert.deepEqual((await stored(page)).bookPosition, saturated, `${pointer} swipe during a turn retains one intent`);
    report.input.push({ pointer, passed: true });
  }
  for (const cancellation of ['resize', 'direct', 'contents', 'font', 'focus', 'pointer', 'view', 'layout', 'hidden', 'error', 'motion', 'modal', 'book']) {
    if (cancellation === 'contents') await size(page, 1440, 13);
    await heldTurn(); await rawClick(page, 'next-page');
    if (cancellation === 'resize') await page.setViewportSize({ width: 410, height: 844 });
    if (cancellation === 'direct') await jump(page, 6);
    if (cancellation === 'contents') await page.locator('#chapter-list [data-node-id]').first().click();
    if (cancellation === 'font') await page.locator('#appearance-button').press('ArrowRight');
    if (cancellation === 'focus') await page.locator('#focus-button').click();
    if (cancellation === 'pointer') {
      const box = await page.locator('#book-spread').boundingBox(); const x = box.x + box.width * .8; const y = box.y + 12;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'pen' });
      await page.setViewportSize({ width: 420, height: 844 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 140, y, button: 'left', clickCount: 1, pointerType: 'pen' });
    }
    if (cancellation === 'view') { await page.locator('#original-view').click(); await page.locator('#original-stage canvas').waitFor(); }
    if (cancellation === 'layout') { await page.locator('#scroll-layout').click(); await settled(page); }
    if (cancellation === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (cancellation === 'error') await page.evaluate(() => { for (const animation of window.auditAnimations) animation.cancel(); });
    if (cancellation === 'motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (cancellation === 'modal') await page.locator('#text-help-button').click();
    if (cancellation === 'book') await importPdf(page, 'second-isolated-source', fixtures[1][1]);
    await page.evaluate(() => { window.auditHold = false; });
    await pause(250);
    const events = await page.evaluate(() => window.auditEvents);
    assert.equal(events.filter(e => e.type === 'turn-commit').length, 0, `${cancellation}: stale turn committed`);
    assert.equal(await page.locator('.page-turn-layer').count(), 0, `${cancellation}: leaked layer`);
    assert.equal(events.filter(e => e.type === 'turn-start').length, 1, `${cancellation}: pending intent leaked`);
    const cancelledAt = (await stored(page)).bookPosition;
    if (cancellation === 'hidden') await page.evaluate(() => {
      delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'));
    });
    if (cancellation === 'modal') await page.locator('#modal-close').click();
    await page.locator('#book-view').click(); await page.locator('#pages-layout').click(); await settled(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const before = (await stored(page)).bookPosition;
    await reloadBook(page);
    const after = (await stored(page)).bookPosition;
    assert.equal(after.page, before.page, `${cancellation}: reload source page`);
    assert.deepEqual(after.source, before.source, `${cancellation}: reload source identity`);
    report.input.push({ cancellation, cancelledAt, before, after, events });
  }
  await size(page, 390, 19);
  await importPdf(page, 'end-source', makeFidelityPdf(Array.from({ length: 3 }, (_, i) => ({ items: [{ text: `A short source page ${i + 1}.`, y: 700 }] }))));
  await jump(page, 2); await page.evaluate(() => { window.auditHold = true; window.auditAnimations = []; }); await clear(page);
  await rawClick(page, 'next-page'); await page.waitForFunction(() => window.auditAnimations.length > 0);
  await rawClick(page, 'next-page'); await release();
  assert.equal((await stored(page)).bookPosition.page, 3, 'EOF remains on final source page');
  assert.equal(await page.locator('#next-page').isDisabled(), true);
  report.input.push({ eof: true, events: await page.evaluate(() => window.auditEvents) });
  await importPdf(page, 'preparation-source', makeFidelityPdf(Array.from({ length: 10 }, (_, i) => ({ items: [{ text: `An exact source page ${i + 1}.`, y: 700 }] }))));
  for (const motion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: motion }); await jump(page); await reloadBook(page); await clear(page);
    // Delay the real PDF worker's cold text request, then send real input while
    // production preparation is pending. No reader handler is called directly.
    await page.evaluate(() => { window.auditHoldExtraction = true; window.auditWorkerMessages = []; });
    await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => window.auditWorkerMessages.length > 0);
    await page.keyboard.press('ArrowRight');
    const pending = await page.evaluate(() => window.auditEvents);
    assert.equal(pending.filter(e => e.type === 'turn-pending').length, 1, 'input during cold extraction was lost');
    assert.equal(pending.filter(e => e.type === 'turn-ready').length, 0, 'preparation gate did not hold');
    await page.evaluate(() => { window.auditHoldExtraction = false; for (const send of window.auditWorkerMessages) send(); });
    await settled(page); await pause(80); await settled(page);
    assert.equal((await stored(page)).bookPosition.page, 3, 'preparation burst final source page');
    assert.equal((await stored(page)).bookPosition.offset, 0, 'preparation burst final text anchor');
    report.input.push({ preparation: true, motion, events: await page.evaluate(() => window.auditEvents) });
  }
  await cdp.detach();
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
    window.auditAnimations = []; window.auditHold = false;
    window.auditHoldExtraction = false; window.auditWorkerMessages = [];
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      if (window.auditHoldExtraction && args[0]?.action === 'GetTextContent') window.auditWorkerMessages.push(() => postMessage.apply(this, args));
      else return postMessage.apply(this, args);
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.classList.contains('page-turn-leaf') && window.auditHold) {
        animation.pause(); window.auditAnimations.push(animation);
      }
      return animation;
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
  if (selection !== 'metrics') await input(page);
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${selection}${baseline ? ' baseline diagnostic' : ''}; evidence: ${run}`);
} catch (error) { report.failure = error.stack; throw error; }
finally { await writeFile(`${run}/report.json`, JSON.stringify(report, null, 2)); await context?.close(); await server.close(); }
