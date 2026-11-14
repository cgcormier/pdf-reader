import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer as createTcpServer } from 'node:net';
import { createServer } from 'vite';
import { makeLayoutPdf } from './pdf-layout-fixture.mjs';
import { settledReader, captureReader } from './reader-capture.mjs';

// Synthetic PDF and semantic outline; isolated origin/profile never touch the user's shelf.
const baseline = process.argv.includes('--baseline');
const full = process.argv.includes('--all');
const matrix = full || process.argv.includes('--matrix');
const focus = process.argv.includes('--focus');
const robust = full || process.argv.includes('--robust');
const perf = process.argv.includes('--perf');
const navigation = full || process.argv.includes('--navigation');
assert.ok(process.argv.slice(2).every(arg => ['--baseline', '--matrix', '--focus', '--robust', '--perf', '--navigation', '--all'].includes(arg)), 'Only --baseline, --matrix, --focus, --robust, --perf, --navigation and --all are supported');
const root = process.cwd();
await mkdir(path.join(root, 'output/playwright'), { recursive: true });
const run = await mkdtemp(path.join(root, 'output/playwright/contents-resize-'));
const reservation = createTcpServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = await createServer({ root, cacheDir: path.join(run, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }, clearScreen: false });
const report = { run, baseline, fixture: 'Synthetic 48-page PDF and nested outline; no real analyzer claims', checks: [], errors: [], screenshots: [] };
const bytes = Array.from(makeLayoutPdf(Array.from({ length: 48 }, (_, index) => ({ items: [
  { text: `A reading companion - page ${index + 1}`, x: 50, y: 730, size: 18 },
  ...Array.from({ length: 24 }, (_, line) => ({ text: `Original fixture prose line ${line + 1} invites unhurried reading.`, x: 50, y: 690 - line * 22, size: 12 })),
] }))));
let sequence = 0, context;
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
async function repeatedDrags(page, count, prefix) {
  const measurements = [];
  await page.locator('#contents-resizer').press('Home'); await settledReader(page); await page.waitForTimeout(700);
  for (let index = 0; index < count; index++) {
    await page.evaluate(() => {
      window.__resizeMetrics = []; window.__folioReaderMetric = metric => window.__resizeMetrics.push(metric);
      const scroll = document.body.classList.contains('scroll-mode'), original = document.querySelector('#original-view').getAttribute('aria-pressed') === 'true';
      const number = document.querySelector('#page-input').value;
      window.__resizeSelector = scroll ? `#scroll-stage [data-source-page="${number}"]${original ? ' canvas' : ''}` : original ? '#original-stage canvas' : '#book-spread > .paper-page';
      window.__resizeLeaf = document.querySelector(window.__resizeSelector);
      window.__resizeFrames = []; window.__resizeFrameActive = true; let previous = performance.now();
      const frame = time => { if (!window.__resizeFrameActive) return; window.__resizeFrames.push(time - previous); previous = time; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    });
    const before = await width(page), box = await page.locator('#contents-resizer').boundingBox(), x = box.x + box.width / 2, y = box.y + 100;
    await page.mouse.move(x, y); await page.mouse.down(); const began = performance.now();
    await page.mouse.move(x + (index % 2 ? -220 : 220), y, { steps: 16 });
    const during = await page.evaluate(() => ({ leafRetained: window.__resizeLeaf === document.querySelector(window.__resizeSelector),
      fits: window.__resizeMetrics.filter(metric => metric.type === 'fitting-start').length, frames: window.__resizeFrames }));
    if (index === 0) await shot(page, `${prefix}-during`, { mid: true });
    await page.mouse.up(); const released = performance.now(); await settledReader(page);
    const after = await page.evaluate(() => { window.__resizeFrameActive = false; return { metrics: window.__resizeMetrics, surfaceRetained: window.__resizeLeaf === document.querySelector(window.__resizeSelector), original: document.querySelector('#original-view').getAttribute('aria-pressed') === 'true' }; });
    const frames = during.frames.filter(value => value > 0).sort((a, b) => a - b);
    const result = { index, before, after: await width(page), pointerMilliseconds: Math.round(released - began), settleMilliseconds: Math.round(performance.now() - released),
      retainedDuring: during.leafRetained, retainedAfter: after.surfaceRetained, original: after.original, fittingStartsDuring: during.fits, fittingStartsAfter: after.metrics.filter(metric => metric.type === 'fitting-start').length,
      frameCount: frames.length, frameP95: frames[Math.floor(frames.length * .95)], frameMaximum: frames.at(-1) };
    measurements.push(result);
    assert.equal(result.retainedDuring, true, JSON.stringify(result)); if (result.original) assert.equal(result.retainedAfter, true, JSON.stringify(result)); assert.equal(result.fittingStartsDuring, 0, JSON.stringify(result));
    assert.ok(result.settleMilliseconds < 10000, JSON.stringify(result));
    await page.waitForTimeout(700); // Isolate this gesture from its speculative warmup.
  }
  await shot(page, `${prefix}-after`); return measurements;
}

async function scrollSource(page) {
  return page.evaluate(async () => {
    const stage = document.querySelector('#scroll-stage'), number = Number(document.querySelector('#progress-slider').value);
    const leaf = stage.querySelector(`[data-source-page="${number}"]`), layout = leaf?.layoutModel;
    if (!layout) throw new Error('No source layout at scroll reading page');
    const readingY = stage.getBoundingClientRect().top + 18;
    const nodes = [...leaf.querySelectorAll('[data-layout-start]')];
    const node = nodes.find(node => node.getBoundingClientRect().bottom > readingY) ?? nodes.at(-1);
    const box = node.getBoundingClientRect(), caret = document.caretRangeFromPoint(box.left + Math.min(18, box.width / 4), Math.max(box.top + 1, Math.min(box.bottom - 1, readingY)));
    let offset = Number(node.dataset.layoutStart);
    if (caret && node.contains(caret.startContainer)) { const range = document.createRange(); range.selectNodeContents(node); range.setEnd(caret.startContainer, caret.startOffset); offset += range.toString().length; }
    const { sourceAt } = await import('/src/pdf-layout.js');
    return { page: number, offset, source: sourceAt(layout.projection, offset), excerpt: layout.projection.text.slice(offset, offset + 80) };
  });
}
async function scrollFraction(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('#scroll-stage'), number = Number(document.querySelector('#progress-slider').value);
    const leaf = stage.querySelector(`[data-source-page="${number}"]`), box = leaf.getBoundingClientRect();
    return { page: number, fraction: Math.max(0, Math.min(1, (stage.getBoundingClientRect().top + 16 - box.top) / box.height)) };
  });
}

async function gotoSource(page, number) {
  await page.locator('#page-input').fill(String(number)); await page.locator('#page-input').press('Enter');
  await page.locator('#page-input').blur();
  await page.waitForFunction(expected => Number(document.querySelector('#progress-slider').value) === expected, number);
  await settledReader(page, number);
}

async function inspectControls(page) {
  return page.evaluate(() => {
    const issues = [], controls = [...document.querySelectorAll('.reader-toolbar button, .reader-footer button, .reader-footer input')].filter(node => node.checkVisibility());
    for (const node of controls) {
      const rect = node.getBoundingClientRect(), container = node.closest('.reader-toolbar, .reader-footer').getBoundingClientRect();
      if (rect.left < container.left - 1 || rect.right > container.right + 1) issues.push(`${node.id}: outside container`);
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (rect.top >= 0 && rect.bottom <= innerHeight && hit && !node.contains(hit)) issues.push(`${node.id}: center intercepted by ${hit.id || hit.tagName}`);
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); const lines = new Set();
      while (walker.nextNode()) if (walker.currentNode.textContent.trim()) {
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const line of range.getClientRects()) if (line.width) lines.add(Math.round(line.y));
      }
      if (node.closest('.reader-toolbar') && lines.size > 1) issues.push(`${node.id}: label wraps across ${lines.size} lines`);
    }
    for (let i = 0; i < controls.length; i++) for (const other of controls.slice(i + 1)) {
      const a = controls[i].getBoundingClientRect(), b = other.getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) issues.push(`${controls[i].id}/${other.id}: overlap`);
    }
    return issues;
  });
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
  await server.listen(); report.origin = `http://127.0.0.1:${port}`;
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
    if (full || !focus && !robust && !perf && !navigation) {
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
    if (full || !robust && !perf && !navigation) {
    await check('focused separator crossing mobile breakpoint returns focus to Contents', async () => {
      await page.setViewportSize({ width: 1000, height: 640 }); await settledReader(page); await page.locator('#contents-resizer').focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-resizer', 'Separator was not focused before crossing');
      await page.setViewportSize({ width: 820, height: 640 });
      await shot(page, 'separator-breakpoint-observed');
      await page.waitForFunction(() => document.activeElement?.id === 'contents-toggle', undefined, { timeout: 3000 }).catch(async error => { throw new Error(`${error.message}; state=${JSON.stringify(await geometry(page))}`); });
      assert.equal(await page.locator('[inert]').count(), 0);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#book-contents').contains(document.activeElement));
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-toggle');
      assert.equal(await page.locator('[inert]').count(), 0);
      await shot(page, 'separator-mobile-focus'); await page.setViewportSize({ width: 1440, height: 900 }); await settledReader(page);
    });

    await check('deliberate desktop focus departure does not force Contents on mobile', async () => {
      await page.setViewportSize({ width: 1000, height: 640 }); await settledReader(page);
      await page.locator('#contents-resizer').focus(); await page.locator('#page-input').focus();
      await page.setViewportSize({ width: 820, height: 640 }); await settledReader(page);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'page-input');
      await page.setViewportSize({ width: 1440, height: 900 }); await settledReader(page);
    });

    }
    if (matrix) {
      await fixture(page);
      for (const [viewport, size] of [['narrow', { width: 821, height: 900 }], ['short', { width: 1000, height: 420 }], ['wide', { width: 1440, height: 900 }]]) {
        for (const mode of ['book', 'original']) for (const layout of ['pages', 'scroll']) for (const paper of ['light', 'dark']) {
          await check(`matrix ${viewport} ${mode} ${layout} ${paper} maximum`, async () => {
            await page.setViewportSize(size); await page.locator(`#${mode}-view`).click(); await page.locator(`#${layout}-layout`).click();
            if (await page.locator('body').evaluate(body => body.classList.contains('dark-paper')) !== (paper === 'dark')) await page.locator('#paper-button').click();
            await page.locator('#contents-resizer').press('End'); await settledReader(page);
            const snapshot = await shot(page, `matrix-${viewport}-${mode}-${layout}-${paper}`), issues = await inspectControls(page);
            assert.equal(snapshot.geometry.horizontalOverflow, 0); assert.equal(snapshot.geometry.listOverflow, 0);
            assert.deepEqual(issues, [], `Toolbar/footer geometry: ${issues.join('; ')}`); return snapshot;
          });
        }
      }
    }

    if (robust) {
      await fixture(page); await page.setViewportSize({ width: 1440, height: 900 });

      await check('Book scroll top preserves chapter decoration while resizing', async () => {
        await page.locator('#book-view').click(); await page.locator('#scroll-layout').click(); await gotoSource(page, 1);
        await page.locator('#scroll-stage').evaluate(stage => { stage.scrollTop = 0; }); await settledReader(page);
        const before = await page.locator('#scroll-stage').evaluate(stage => ({ scroll: stage.scrollTop, title: stage.querySelector('.chapter-title').getBoundingClientRect().y }));
        await page.locator('#contents-resizer').press('Home'); await settledReader(page);
        const after = await page.locator('#scroll-stage').evaluate(stage => ({ scroll: stage.scrollTop, title: stage.querySelector('.chapter-title').getBoundingClientRect().y }));
        await shot(page, 'top-decoration-after');
        assert.ok(Math.abs(after.scroll - before.scroll) <= 2 && Math.abs(after.title - before.title) <= 2, JSON.stringify({ before, after })); return { before, after };
      });
      await check('Book scroll preserves logical source while width changes', async () => {
        await page.locator('#book-view').click(); await page.locator('#scroll-layout').click(); await page.locator('#contents-resizer').press('Home'); await settledReader(page);
        await gotoSource(page, 17); await page.locator('#scroll-stage').evaluate(stage => { stage.scrollTop += 400; }); await settledReader(page);
        const before = await scrollSource(page), stored = await saved(page); await shot(page, 'source-scroll-before');
        await drag(page, 220, 'source-scroll-mid'); const after = await scrollSource(page); await shot(page, 'source-scroll-after');
        assert.equal(after.page, before.page); assert.ok(Math.abs(after.offset - before.offset) <= 80, `Source jumped: ${JSON.stringify({ before, after, stored })}`);
        return { before, after };
      });
      await check('Book pages preserves a continuation anchor after live and settled resizing', async () => {
        await page.locator('#pages-layout').click(); await page.locator('#contents-resizer').press('Home'); await settledReader(page); await gotoSource(page, 17);
        await page.locator('#next-page').click(); await settledReader(page); const before = await saved(page); await shot(page, 'source-pages-before');
        await drag(page, 220, 'source-pages-mid'); const after = await saved(page); await shot(page, 'source-pages-after');
        assert.equal(after.page, before.page); assert.deepEqual(after.bookPosition, before.bookPosition); assert.deepEqual(after.bookmarks, [7, 19]);
        return { before, after };
      });
      await check('Original pages preserves source page and Book anchor across resizing', async () => {
        const anchor = (await saved(page)).bookPosition; await page.locator('#original-view').click(); await gotoSource(page, 17);
        await page.locator('#contents-resizer').press('Home'); await settledReader(page); await drag(page, 220, 'original-pages-mid');
        const after = await saved(page); assert.equal(after.page, 17); assert.deepEqual(after.bookPosition, anchor); assert.deepEqual(after.bookmarks, [7, 19]);
        return shot(page, 'original-pages-after');
      });
      await check('Original scroll keeps normalized source position', async () => {
        await page.locator('#scroll-layout').click(); await page.locator('#contents-resizer').press('Home'); await settledReader(page); await gotoSource(page, 17);
        await page.locator('#scroll-stage').evaluate(stage => { stage.scrollTop += 300; }); await settledReader(page);
        await page.locator('#bookmark-button').click(); await page.locator('#bookmark-button').click();
        const before = await scrollFraction(page); await drag(page, 220, 'original-scroll-mid');
        await page.locator('#bookmark-button').click(); await page.locator('#bookmark-button').click(); const after = await scrollFraction(page);
        assert.equal(after.page, before.page); assert.ok(Math.abs(after.fraction - before.fraction) < .03, JSON.stringify({ before, after }));
        await shot(page, 'original-scroll-after'); return { before, after };
      });

      await check('pointer buttons work without dragging at both bounds', async () => {
        await page.locator('#contents-resizer').press('Home'); await settledReader(page);
        assert.equal(await page.locator('#contents-narrower').getAttribute('aria-disabled'), 'true');
        await page.locator('#contents-wider').click(); assert.equal(Math.round(await width(page)), 276);
        await page.locator('#contents-narrower').click(); assert.equal(Math.round(await width(page)), 260);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-narrower');
        await page.locator('#contents-narrower').press('Enter'); assert.equal(Math.round(await width(page)), 260);
        await page.locator('#contents-resizer').press('End'); await settledReader(page);
        assert.equal(await page.locator('#contents-wider').getAttribute('aria-disabled'), 'true');
        await page.locator('#contents-narrower').click(); assert.equal(Math.round(await width(page)), 464);
        await page.locator('#contents-wider').click(); assert.equal(Math.round(await width(page)), 480);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-wider');
        await page.locator('#contents-wider').press('Enter'); assert.equal(Math.round(await width(page)), 480);
        const sourcePage = await page.locator('#page-input').inputValue(); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#page-input').inputValue(), sourcePage);
        await settledReader(page); return shot(page, 'pointer-buttons');
      });
      for (const motion of ['reduce', 'no-preference']) await check(`modal interrupt clears active resize ${motion}`, async () => {
        await page.emulateMedia({ reducedMotion: motion }); await page.locator('#contents-resizer').press('Home'); await settledReader(page);
        const box = await page.locator('#contents-resizer').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 100, { steps: 6 });
        await page.locator('#launch-help').evaluate(node => node.click()); await page.locator('#modal[open]').waitFor();
        const resizing = (await geometry(page)).resizing; await page.mouse.up();
        await page.locator('#modal-close').click(); await settledReader(page); await shot(page, `modal-interrupt-${motion}`);
        assert.equal(resizing, false, 'Opening help left drag active behind modal'); assert.equal((await geometry(page)).resizing, false);
      });
      await check('native touch pointer changes width and releases cleanly', async () => {
        await page.locator('#contents-resizer').press('Home'); await settledReader(page);
        const before = await width(page), box = await page.locator('#contents-resizer').boundingBox(), cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        const x = box.x + box.width / 2, y = box.y + 100;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 16, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach(); await settledReader(page);
        assert.ok(Math.abs(await width(page) - before - 96) <= 2); assert.equal((await geometry(page)).resizing, false); return shot(page, 'touch-after');
      });

      await check('synthetic visibility interruption clears pointer interaction', async () => {
        await page.locator('#contents-resizer').press('Home'); await settledReader(page);
        const box = await page.locator('#contents-resizer').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 100);
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
        const active = (await geometry(page)).resizing;
        await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }); await page.mouse.up(); await settledReader(page);
        assert.equal(active, false); return { mechanism: 'Synthetic hidden/visible lifecycle events against actual pointer interaction', geometry: await geometry(page) };
      });
      await check('pointer breakpoint crossing clears capture cursor and inert state', async () => {
        const box = await page.locator('#contents-resizer').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 100);
        await page.setViewportSize({ width: 390, height: 640 }); await page.mouse.up(); await settledReader(page);
        assert.equal((await geometry(page)).resizing, false); assert.equal(await page.locator('[inert]').count(), 0);
        await page.locator('#contents-toggle').click(); await page.locator('#launch-help').click(); await page.locator('#modal-close').click(); await page.keyboard.press('Escape');
        assert.equal(await page.locator('[inert]').count(), 0); await page.setViewportSize({ width: 1440, height: 900 }); await settledReader(page);
      });
      await check('synthetic pointercancel rolls back and unexpected lost capture commits', async () => {
        await page.locator('#contents-resizer').press('Home'); await settledReader(page); const handle = page.locator('#contents-resizer');
        const before = await width(page), box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 130, box.y + 100, { steps: 6 });
        await handle.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' }); await page.mouse.up(); assert.equal(Math.round(await width(page)), Math.round(before));
        const next = await handle.boundingBox(); await page.mouse.move(next.x + next.width / 2, next.y + 100); await page.mouse.down(); await page.mouse.move(next.x + 130, next.y + 100, { steps: 6 });
        await handle.evaluate(node => node.releasePointerCapture(1)); await page.mouse.up();
        assert.ok(await width(page) > before + 80); assert.equal((await geometry(page)).resizing, false); await settledReader(page);
        return { mechanism: 'Real mouse capture, synthetic cancellation event; lost capture via native releasePointerCapture', geometry: await geometry(page) };
      });
    }

    if (navigation || robust) {
      await fixture(page); await page.setViewportSize({ width: 1440, height: 900 });
      for (const destination of ['next', 'same-page-form', 'far-contents']) await check(`explicit ${destination} navigation wins pending resize restoration`, async () => {
        await page.locator('#book-view').click(); await page.locator('#scroll-layout').click(); await page.locator('#contents-resizer').press('Home'); await settledReader(page); await gotoSource(page, 17);
        await page.locator('#scroll-stage').evaluate(stage => { stage.scrollTop += 400; }); await settledReader(page); const before = await scrollSource(page);
        if (destination === 'far-contents') await page.locator('#contents-search').fill('Chapter 24:');
        const inputTrace = await page.evaluate(destination => {
          const trace = [{ page: document.querySelector('#page-input').value, actualPage: document.querySelector('#progress-slider').value, nextDisabled: document.querySelector('#next-page').disabled }];
          document.querySelector('#contents-wider').click();
          trace.push({ page: document.querySelector('#page-input').value, actualPage: document.querySelector('#progress-slider').value, nextDisabled: document.querySelector('#next-page').disabled });
          if (destination === 'next') document.querySelector('#next-page').click();
          else if (destination === 'far-contents') document.querySelector('[data-node-id="part-3-chapter-5"]').click();
          else { document.querySelector('#page-input').value = '17'; document.querySelector('#page-form').requestSubmit(); }
          trace.push({ page: document.querySelector('#page-input').value, actualPage: document.querySelector('#progress-slider').value, nextDisabled: document.querySelector('#next-page').disabled }); return trace;
        }, destination);
        await settledReader(page); const after = await scrollSource(page); await shot(page, `navigation-${destination}`);
        const expectedPage = destination === 'next' ? 18 : destination === 'far-contents' ? 47 : 17;
        assert.equal(after.page, expectedPage, JSON.stringify({ inputTrace, before, after }));
        const persisted = await saved(page); assert.equal(persisted.page, expectedPage); assert.equal(persisted.bookPosition.page, expectedPage);
        if (destination === 'same-page-form') assert.ok(after.offset <= 2, JSON.stringify({ before, after }));
        await page.reload(); await settledReader(page, expectedPage); const reopened = await saved(page);
        assert.equal(reopened.page, expectedPage); assert.equal(reopened.bookPosition.page, expectedPage);
        return { inputTrace, persisted, reopened, mechanism: 'Synchronous click activation then navigation in one event task before 160ms resize settle', before, after };
      });
    }

    if (navigation) await check('Book page flip accepts Next immediately after width action', async () => {
      await page.locator('#book-view').click(); await page.locator('#pages-layout').click(); await page.locator('#contents-resizer').press('Home'); await settledReader(page); await gotoSource(page, 17);
      const before = await saved(page);
      await page.evaluate(() => { document.querySelector('#contents-wider').click(); document.querySelector('#next-page').click(); });
      await settledReader(page); const after = await saved(page); await shot(page, 'navigation-pages-next');
      assert.ok(after.page > before.page || after.bookPosition.offset > before.bookPosition.offset, JSON.stringify({ before, after })); return { before, after };
    });

    if (navigation) await check('queued first move interrupted by help preserves a working next turn', async () => {
      await page.locator('#book-view').click(); await page.locator('#pages-layout').click(); await page.locator('#contents-resizer').press('Home'); await settledReader(page); await gotoSource(page, 17);
      const before = await saved(page), box = await page.locator('#contents-resizer').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
      await page.locator('#contents-resizer').evaluate((node, box) => {
        node.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: box.x + 120, clientY: box.y + 100 }));
        document.querySelector('#launch-help').click();
      }, box);
      await page.locator('#modal[open]').waitFor(); await page.mouse.up(); await page.locator('#modal-close').click(); await settledReader(page);
      await page.locator('#next-page').click(); await settledReader(page); const after = await saved(page); await shot(page, 'queued-move-modal-next');
      assert.ok(after.page > before.page || after.bookPosition.offset > before.bookPosition.offset, JSON.stringify({ before, after }));
      return { mechanism: 'Native capture then synthetic first move/help in one task before rAF, native modal close and Next', before, after };
    });

    if (perf) {
      await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('#book-view').click(); await page.locator('#pages-layout').click(); await settledReader(page);
      await check('no-movement pointer click retains the fitted spread', async () => {
        await page.waitForTimeout(700); // Let idle spread warmup finish before measuring only the click.
        await page.evaluate(() => { window.__resizeMetrics = []; window.__folioReaderMetric = metric => window.__resizeMetrics.push(metric); window.__resizeLeaf = document.querySelector('#book-spread').firstElementChild; });
        await page.locator('#contents-resizer').click(); await settledReader(page);
        const result = await page.evaluate(() => ({ leafRetained: window.__resizeLeaf === document.querySelector('#book-spread').firstElementChild, fittingStarts: window.__resizeMetrics.filter(metric => metric.type === 'fitting-start').length, spreadCommits: window.__resizeMetrics.filter(metric => metric.type === 'spread-dom').length }));
        await shot(page, 'no-op-spread'); assert.equal(result.leafRetained, true, JSON.stringify(result)); assert.equal(result.spreadCommits, 0, JSON.stringify(result)); return result;
      });
      await check('large synthetic outline stays attached across repeated resizes', async () => {
        await fixture(page, { large: true }); await page.locator('#pages-layout').click(); await settledReader(page);
        const measurements = await repeatedDrags(page, 4, 'synthetic');
        assert.equal(await page.locator('[data-node-id]').count(), 632); return { syntheticNodes: 632, measurements };
      });
      await check('actual Hamlet import preserves exact PDF bytes', async () => {
        const file = path.join(root, 'testing_downloads/Hamlet.pdf');
        const digest = createHash('sha256').update(await readFile(file)).digest('hex');
        await page.locator('#file-input').setInputFiles(file); await page.locator('#book-title').filter({ hasText: 'Hamlet' }).waitFor({ timeout: 30000 }); await settledReader(page);
        const stop = page.getByRole('button', { name: 'Stop scan', exact: true });
        if (await stop.count()) { await page.locator('#contents-analysis').evaluate(node => { node.open = true; }); if (await stop.isVisible()) await stop.click(); }
        const stored = await page.evaluate(async () => {
          const { getBook } = await import('/src/storage.js'); const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
          const hash = await crypto.subtle.digest('SHA-256', book.bytes);
          return { filename: book.filename, pages: book.structure.totalPages, nodes: book.structure.nodes.length, status: book.structure.status,
            sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
        });
        assert.equal(stored.sha256, digest); report.realDocument = stored; return stored;
      });
      if (report.realDocument) for (const mode of ['book', 'original']) for (const layout of ['pages', 'scroll']) await check(`real Hamlet ${mode} ${layout} repeated drag`, async () => {
        await page.locator(`#${mode}-view`).click(); await page.locator(`#${layout}-layout`).click(); await settledReader(page); await gotoSource(page, 10);
        const measurements = await repeatedDrags(page, mode === 'book' && layout === 'pages' ? 6 : 2, `hamlet-${mode}-${layout}`);
        assert.equal(await page.locator('#page-input').inputValue(), '10'); return measurements;
      });

    }

  }
} catch (error) { report.errors.push(error.stack || error.message); }
finally { await context?.close(); await server.close(); await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ run, checks: report.checks.length, failed: report.checks.filter(check => check.pass === false), errors: report.errors, screenshots: report.screenshots.length }, null, 2));
if (report.errors.length || report.checks.some(check => check.pass === false)) process.exitCode = 1;
