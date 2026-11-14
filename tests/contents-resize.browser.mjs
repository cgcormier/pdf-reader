import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { makeLayoutPdf } from './pdf-layout-fixture.mjs';
import { settledReader, captureReader } from './reader-capture.mjs';

// Synthetic PDF and semantic outline; isolated origin/profile never touch the user's shelf.
const baseline = process.argv.includes('--baseline');
assert.ok(process.argv.slice(2).every(arg => ['--baseline'].includes(arg)), 'Only --baseline is supported');
const root = process.cwd();
await mkdir(path.join(root, 'output/playwright'), { recursive: true });
const run = await mkdtemp(path.join(root, 'output/playwright/contents-resize-'));
const server = await createServer({ root, cacheDir: path.join(run, 'vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, clearScreen: false });
const report = { run, baseline, fixture: 'Synthetic 48-page PDF and nested outline; no real analyzer claims', checks: [], errors: [], screenshots: [] };
const bytes = Array.from(makeLayoutPdf(Array.from({ length: 48 }, (_, index) => ({ items: [
  { text: `A reading companion - page ${index + 1}`, x: 50, y: 730, size: 18 },
  ...Array.from({ length: 24 }, (_, line) => ({ text: `Original fixture prose line ${line + 1} invites unhurried reading.`, x: 50, y: 690 - line * 22, size: 12 })),
] }))));
let sequence = 0, context, port;
async function fixture(page, { status = 'complete', empty = false, large = false } = {}) {
  await page.goto(`http://127.0.0.1:${port}/tests/fidelity-check.html`);
  await page.evaluate(async ({ bytes, status, empty, id, large }) => {
    const { putBook, savePreference } = await import('/src/storage.js');
    const { STRUCTURE_VERSION } = await import('/src/document-structure.js');
    const nodes = [];
    for (let part = 0; part < 4; part++) {
      const id = `part-${part}`;
      nodes.push({ id, parentId: null, kind: 'part', level: 0, title: `Part ${part + 1}: The shape of a reading life`, page: part * 12 + 1 });
      for (let chapter = 0; chapter < 6; chapter++) {
        const child = `${id}-chapter-${chapter}`;
        nodes.push({ id: child, parentId: id, kind: 'chapter', level: 1, title: `Chapter ${part * 6 + chapter + 1}: A longer title about attention, places and memory`, page: part * 12 + chapter * 2 + 1 });
        if (!chapter) nodes.push({ id: `${child}-section`, parentId: child, kind: 'section', level: 2, title: 'A small beginning', page: part * 12 + 1 });
      }
    }
    nodes.forEach(node => Object.assign(node, { y: null, source: 'outline', confidence: 'high', evidence: ['Synthetic browser fixture'] }));
    if (large) for (let index = 0; index < 600; index++) nodes.push({ ...nodes[1], id: `large-${index}`, parentId: `part-${index % 4}`,
      title: `Research note ${index + 1}: Detail in a large outline`, page: index % 48 + 1 });
    const structure = { version: STRUCTURE_VERSION, status, totalPages: 48, nodes: empty ? [] : nodes,
      scannedPages: status === 'complete' ? Array.from({ length: 48 }, (_, i) => i + 1) : [1, 2],
      failedPages: status === 'error' ? [3] : [], textPages: 48, candidates: [],
      pageNavigation: [{ id: 'pdf-bookmark', title: 'Publisher destination', page: 17, source: 'outline' }] };
    await putBook({ id, title: 'The Art of Paying Attention', author: 'A synthetic reading edition', filename: 'contents-navigation.pdf',
      bytes: new Uint8Array(bytes).buffer, page: 1, bookmarks: [7, 19], addedAt: Date.now(), source: 'structure', readingLayout: 'scroll', view: 'book',
      chapters: [{ title: 'A reading companion', page: 1 }], contentsExpanded: {}, structure });
    savePreference('active-book', id);
    savePreference('reading-layout', 'scroll');
    savePreference('appearance', { size: 17, paper: 'light' });
  }, { bytes, status, empty, large, id: `contents-navigation-${++sequence}` });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#book-title').filter({ hasText: 'The Art of Paying Attention' }).waitFor();
  await settledReader(page, 1);
}

async function check(name, action) {
  const started = performance.now();
  try { report.checks.push({ name, pass: true, milliseconds: Math.round(performance.now() - started), details: await action() }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function geometry(page) {
  return page.evaluate(() => {
    const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const list = document.querySelector('#chapter-list');
    return { viewport: { width: innerWidth, height: innerHeight }, sidebar: rect('#book-contents'), handle: rect('#contents-resizer'),
      reader: rect('.reader-panel'), list: rect('#chapter-list'), horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      listOverflow: list.scrollWidth - list.clientWidth, active: document.activeElement?.id,
      resizing: document.body.classList.contains('contents-resizing'), page: document.querySelector('#page-input').value, controls: [...document.querySelectorAll('.reader-toolbar button, .reader-footer button, .reader-footer input')].filter(node => node.checkVisibility()).map(node => ({ id: node.id, rect: node.getBoundingClientRect().toJSON() })) };
  });
}
async function shot(page, name, { mid = false } = {}) {
  const file = `${name}.png`;
  const reader = mid ? null : await captureReader(page, path.join(run, file));
  if (mid) await page.screenshot({ path: path.join(run, file) });
  const details = { file, geometry: await geometry(page), reader };
  report.screenshots.push(details); return details;
}
async function drag(page, delta, midName) {
  const box = await page.locator('#contents-resizer').boundingBox();
  assert.ok(box && box.width > 0, 'Resize handle needs usable geometry');
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 120);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 8 });
  if (midName) await shot(page, midName, { mid: true });
  await page.mouse.up(); await settledReader(page);
  return geometry(page);
}
async function width(page) { return (await page.locator('#book-contents').boundingBox()).width; }
async function saved(page) {
  return page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return { page: book.page, bookmarks: book.bookmarks, bookPosition: book.bookPosition, scrollPosition: book.scrollPosition, expanded: book.contentsExpanded };
  });
}
try {
  await server.listen(); port = server.httpServer.address().port;
  context = await chromium.launchPersistentContext(path.join(run, 'profile'), { channel: 'chrome', headless: true, reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
  await fixture(page);
  if (baseline) {
    for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['short', { width: 1000, height: 420 }], ['mobile', { width: 390, height: 640 }]]) {
      await page.setViewportSize(size); await settledReader(page);
      if (size.width < 821) await page.locator('#contents-toggle').click();
      await shot(page, `baseline-${name}`);
      if (size.width < 821) await page.locator('#contents-close').click();
    }
  } else {
    await page.locator('#contents-resizer').waitFor({ state: 'visible' });
    await check('pointer width follows during drag and remains after release', async () => {
      const before = await width(page), after = await drag(page, 96, 'pointer-middle');
      assert.ok(Math.abs(after.sidebar.width - before - 96) < 2, JSON.stringify(after));
      assert.equal(after.resizing, false); await shot(page, 'pointer-after'); return after;
    });
    await check('keyboard arrows use 16px and Shift uses 48px without page turns', async () => {
      const handle = page.locator('#contents-resizer'); await handle.focus();
      const before = await width(page), source = await page.locator('#page-input').inputValue();
      await handle.press('ArrowLeft'); assert.ok(Math.abs(await width(page) - before + 16) < 2);
      await handle.press('Shift+ArrowRight'); assert.ok(Math.abs(await width(page) - before - 32) < 2);
      assert.equal(await page.locator('#page-input').inputValue(), source); await settledReader(page);
      return shot(page, 'keyboard-width');
    });
    await check('Home End and pointer clamp both width bounds', async () => {
      const handle = page.locator('#contents-resizer'); await handle.press('Home');
      assert.equal(Math.round(await width(page)), 260); await settledReader(page); await shot(page, 'minimum');
      await handle.press('End'); assert.equal(Math.round(await width(page)), 480); await settledReader(page); await shot(page, 'maximum');
      await drag(page, 300); assert.equal(Math.round(await width(page)), 480);
      await drag(page, -600); assert.equal(Math.round(await width(page)), 260);
      return geometry(page);
    });
    await check('Escape rolls back in-flight pointer resize', async () => {
      const before = await width(page), box = await page.locator('#contents-resizer').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 80, { steps: 8 });
      assert.ok(await width(page) > before + 80); await page.keyboard.press('Escape'); await page.mouse.up();
      assert.ok(Math.abs(await width(page) - before) < 2); assert.equal((await geometry(page)).resizing, false);
      await settledReader(page); return shot(page, 'escape-rollback');
    });
    await check('release outside handle commits and clears drag cursor', async () => {
      const before = await width(page), box = await page.locator('#contents-resizer').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 100, 2, { steps: 8 }); await page.mouse.up();
      assert.ok(await width(page) > before + 80); assert.equal((await geometry(page)).resizing, false);
      await settledReader(page); return shot(page, 'outside-release');
    });
    await check('viewport clamp retains preferred width and mobile removes separator', async () => {
      await page.locator('#contents-resizer').press('End'); await settledReader(page);
      const measurements = [];
      for (const size of [{ width: 1000, height: 420 }, { width: 821, height: 640 }, { width: 820, height: 640 }, { width: 390, height: 640 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(size); await settledReader(page);
        if (size.width <= 820) {
          assert.equal(await page.locator('#contents-resizer').isVisible(), false);
          await page.locator('#contents-toggle').click(); await shot(page, `viewport-${size.width}`); await page.locator('#contents-close').click();
          assert.equal(await page.locator('[inert]').count(), 0);
        } else {
          assert.equal(Math.round(await width(page)), Math.min(480, size.width - 560));
          await shot(page, `viewport-${size.width}`);
        }
        const state = await geometry(page); assert.ok(state.horizontalOverflow <= 1, JSON.stringify(state)); measurements.push(state);
      }
      return measurements;
    });

    await check('dark focused separator has visible painted affordance', async () => {
      await page.locator('#paper-button').click(); await page.locator('#contents-resizer').focus(); await settledReader(page);
      const shotResult = await shot(page, 'dark-focus'); await page.locator('#paper-button').click(); return shotResult;
    });

    await check('click without movement preserves preferred width through clamp', async () => {
      await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('#contents-resizer').press('End'); await settledReader(page);
      await page.setViewportSize({ width: 1000, height: 420 }); await settledReader(page);
      assert.equal(Math.round(await width(page)), 440);
      await page.locator('#contents-resizer').click();
      await page.setViewportSize({ width: 1440, height: 900 }); await settledReader(page);
      const observed = await width(page); await shot(page, 'no-move-preferred-restoration');
      assert.equal(Math.round(observed), 480, 'Click at viewport clamp overwrote preferred width'); return geometry(page);
    });
    await check('keyboard burst followed by breakpoint change clears pending resize', async () => {
      const handle = page.locator('#contents-resizer'); await handle.press('Home'); await handle.press('ArrowRight');
      await page.setViewportSize({ width: 390, height: 640 }); await settledReader(page);
      await page.locator('#contents-toggle').click(); await page.locator('#launch-help').click(); await page.locator('#modal[open]').waitFor();
      await page.locator('#modal-close').click(); await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 900 }); await settledReader(page);
      assert.equal((await geometry(page)).resizing, false); assert.equal(await page.locator('[inert]').count(), 0);
      return shot(page, 'keyboard-breakpoint-cleanup');
    });

    await check('sticky divider tracks short-desktop rail during document scroll', async () => {
      await page.setViewportSize({ width: 1000, height: 420 }); await page.locator('#pages-layout').click(); await settledReader(page);
      const before = await geometry(page); await page.evaluate(() => scrollTo(0, 220));
      const after = await geometry(page);
      assert.ok(Math.abs(after.sidebar.y - after.handle.y) <= 1, JSON.stringify(after));
      assert.ok(Math.abs(after.sidebar.bottom - after.handle.bottom) <= 1, JSON.stringify(after));
      assert.equal(after.horizontalOverflow, before.horizontalOverflow);
      const result = await shot(page, 'sticky-short-scrolled'); await page.evaluate(() => scrollTo(0, 0)); return result;
    });

  }
} catch (error) { report.errors.push(error.stack || error.message); }
finally { await context?.close(); await server.close(); await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ run, checks: report.checks.length, failed: report.checks.filter(check => check.pass === false), errors: report.errors, screenshots: report.screenshots.length }, null, 2));
if (report.errors.length || report.checks.some(check => check.pass === false)) process.exitCode = 1;
