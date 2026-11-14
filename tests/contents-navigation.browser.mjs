import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as tcpServer } from 'node:net';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { makeLayoutPdf } from './pdf-layout-fixture.mjs';
import { settledReader } from './reader-capture.mjs';
import { waitForAsync } from './browser-wait.mjs';

// A fresh port and browser profile isolate synthetic books from the user's shelf.
const baseline = process.argv.includes('--baseline');
const probe = process.argv.includes('--probe');
assert.ok(process.argv.slice(2).every(arg => ['--baseline', '--probe'].includes(arg)), 'Only --baseline and --probe are supported');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/playwright');
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, `contents-navigation-${baseline ? 'before' : 'after'}-`));
const reserve = tcpServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const server = await createServer({ root, cacheDir: path.join(run, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }, clearScreen: false });
const report = { run, baseline, checks: [], errors: [], screenshots: [], captureDiagnostics: [] };
const bytes = Array.from(makeLayoutPdf(Array.from({ length: 48 }, (_, index) => ({ items: [
  { text: `A reading companion - page ${index + 1}`, x: 50, y: 730, size: 18 },
  ...Array.from({ length: 12 }, (_, line) => ({ text: `Original fixture prose line ${line + 1} invites unhurried reading.`, x: 50, y: 690 - line * 20, size: 12 })),
] }))));
let context;
let sequence = 0;

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
  try {
    const details = await action();
    report.checks.push({ name, pass: true, milliseconds: Math.round(performance.now() - started), details });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, pass: false, error: error.stack || error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
async function openDrawer(page) {
  if (await page.locator('#contents-toggle').isVisible() && await page.locator('#contents-toggle').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#contents-toggle').click();
  }
}
async function visibleGeometry(page) {
  return page.locator('#chapter-list').evaluate(list => {
    const box = list.getBoundingClientRect();
    let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    let top = Math.max(0, box.top), bottom = Math.min(innerHeight, box.bottom);
    for (let parent = list.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
    }
    const links = [...list.querySelectorAll('[data-node-id]')].filter(link => {
      const rect = link.getBoundingClientRect();
      return rect.width && rect.height && rect.top >= top - 1 && rect.bottom <= bottom + 1;
    });
    return { x: box.x, y: box.y, width: box.width, height: box.height,
      visibleWidth: right - left, visibleHeight: bottom - top, fullyVisibleRows: links.length,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      listHorizontalOverflow: list.scrollWidth - list.clientWidth };
  });
}
async function assertGeometry(page, minimum = 90) {
  const geometry = await visibleGeometry(page);
  assert.ok(geometry.visibleHeight >= minimum, `Outline has only ${geometry.visibleHeight}px visible: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.fullyVisibleRows >= 2, `Fewer than two usable outline rows: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.horizontalOverflow <= 1 && geometry.listHorizontalOverflow <= 1, `Horizontal overflow: ${JSON.stringify(geometry)}`);
  return geometry;
}
async function expectActive(page, id, sourcePage) {
  await page.locator(`[data-node-id="${id}"][aria-current="location"]`).waitFor();
  await settledReader(page, sourcePage);
  assert.equal(await page.locator('#page-input').inputValue(), String(sourcePage));
}
async function saved(page) {
  return page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return { bookmarks: book.bookmarks, expanded: book.contentsExpanded, structure: book.structure, page: book.page, bookPosition: book.bookPosition, scrollPosition: book.scrollPosition };
  });
}
async function helpDialogKeepsDrawer(page) {
  await page.setViewportSize({ width: 390, height: 640 });
  await openDrawer(page);
  await page.locator('#launch-help').click();
  await page.locator('#modal[open]').waitFor();
  await page.locator('#modal-body').click();
  assert.equal(await page.locator('#contents-toggle').getAttribute('aria-expanded'), 'true', 'Modal interaction dismissed its underlying drawer');
  await page.locator('#modal-close').click();
  await page.waitForFunction(() => document.activeElement?.id === 'launch-help', undefined, { timeout: 3000 });
  assert.equal(await page.locator('#contents-toggle').getAttribute('aria-expanded'), 'true');
  await screenshot(page, 'after-mobile-help-return');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-toggle');
  assert.equal(await page.locator('[inert]').count(), 0);
}
async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const file = `${name}.png`;
  const png = await page.screenshot({ path: path.join(run, file) });
  report.screenshots.push(file);
  const diagnostics = await page.evaluate(async base64 => {
    const list = document.querySelector('#chapter-list'), bounds = list.getBoundingClientRect();
    const panel = document.querySelector('#book-contents');
    const labels = [...list.querySelectorAll('.chapter-label')].filter(node => {
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      return node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width && rect.height && rect.top >= Math.max(0, bounds.top) && rect.bottom <= Math.min(innerHeight, bounds.bottom) && css.visibility === 'visible';
    });
    const selected = labels[0];
    const result = { labelsWithVisibleGeometry: labels.length, panelVisibility: getComputedStyle(panel).visibility,
      activeId: document.activeElement?.id, listScrollTop: list.scrollTop,
      firstRows: [...list.querySelectorAll('[data-node-id]')].slice(0, 3).map(node => ({ id: node.dataset.nodeId, rect: node.getBoundingClientRect().toJSON(), visible: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        parents: [...function* () { for (let parent = node; parent && parent !== document.body; parent = parent.parentElement) yield parent; }()].map(parent => ({ tag: parent.tagName, id: parent.id, classes: parent.className, hidden: parent.hidden, visibility: getComputedStyle(parent).visibility, opacity: getComputedStyle(parent).opacity, transform: getComputedStyle(parent).transform })) })) };
    if (!selected) return result;
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const labelInk = labels.map(label => {
      const range = document.createRange(); range.selectNodeContents(label);
      const tones = new Array(256).fill(0);
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const x = Math.max(0, Math.floor(rect.left)), y = Math.max(0, Math.floor(rect.top));
        const w = Math.min(canvas.width - x, Math.ceil(rect.width)), h = Math.min(canvas.height - y, Math.ceil(rect.height));
        if (w <= 0 || h <= 0) continue;
        const data = ctx.getImageData(x, y, w, h).data;
        for (let i = 0; i < data.length; i += 4) tones[Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)]++;
      }
      const low = tones.findIndex(n => n), high = tones.findLastIndex(n => n), middle = Math.floor((low + high) / 2);
      return { text: label.textContent, ink: high - low < 40 ? 0 : Math.min(tones.slice(0, middle + 1).reduce((a, b) => a + b, 0), tones.slice(middle + 1).reduce((a, b) => a + b, 0)) };
    });
    return { ...result, labelInk, ink: Math.min(...labelInk.map(label => label.ink)) };
  }, png.toString('base64'));
  report.captureDiagnostics.push({ file, ...diagnostics });
  if (!baseline && diagnostics.labelsWithVisibleGeometry) assert.ok(diagnostics.ink > 5, `Outline text has geometry but no screenshot ink: ${JSON.stringify(diagnostics)}`);
}

try {
  await server.listen();
  context = await chromium.launchPersistentContext(path.join(run, 'profile'), { channel: 'chrome', headless: true, reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await fixture(page);
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['short', { width: 1000, height: 420 }], ['mobile', { width: 390, height: 640 }]]) {
    await page.setViewportSize(size);
    if (size.width < 700) {
      await page.locator('#contents-toggle').click();
      await page.locator('#book-contents').evaluate(panel => { panel.scrollTop = 0; });
    }
    await screenshot(page, `${baseline ? 'before' : 'after'}-${name}`);
    report.checks.push({ name, geometry: await visibleGeometry(page) });
    if (size.width < 700) await page.locator('#contents-close').click();
  }
  if (probe) {
    for (const motion of ['reduce', 'no-preference']) for (let cycle = 0; cycle < 3; cycle++) await check(`mobile opening ${motion} probe ${cycle + 1}`, async () => {
      await page.emulateMedia({ reducedMotion: motion });
      await openDrawer(page);
      await page.waitForFunction(() => document.querySelector('#book-contents').contains(document.activeElement), undefined, { timeout: 3000 });
      assert.ok(await page.locator('#contents-search').evaluate(input => input.checkVisibility({ checkVisibilityCSS: true })));
      await screenshot(page, `probe-mobile-open-${motion}-${cycle + 1}`);
      await page.locator('#contents-search').press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-toggle');
    });
    await check('help dialog interaction preserves underlying drawer and focus return', () => helpDialogKeepsDrawer(page));
    for (const width of [1000, 900, 821]) await check(`toolbar and outline at width ${width}`, async () => {
      if (await page.locator('#contents-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#contents-close').click();
      await page.setViewportSize({ width, height: 420 });
      const geometry = await assertGeometry(page);
      const tools = await page.locator('.reader-toolbar button').evaluateAll(nodes => nodes.filter(node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).map(node => ({ id: node.id, rect: node.getBoundingClientRect().toJSON(), hit: (() => {
        const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })() })));
      await screenshot(page, `probe-short-${width}`);
      assert.ok(tools.every(({ rect, hit }) => rect.left >= -1 && rect.right <= width + 1 && hit), JSON.stringify(tools));
      return { geometry, tools };
    });
    for (const size of [{ width: 1000, height: 420 }, { width: 1000, height: 280 }, { width: 390, height: 420 }]) await check(`expanded analysis controls reachable at ${size.width}x${size.height}`, async () => {
      await page.setViewportSize(size);
      await openDrawer(page);
      await page.locator('#contents-analysis').evaluate(details => { details.open = true; });
      for (const selector of ['#structure-tools button:not([hidden])', '#drop-zone', '#launch-help']) {
        const control = page.locator(selector).first();
        await control.scrollIntoViewIfNeeded();
        assert.ok(await control.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1
            && node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        }), `${selector} is clipped or obstructed`);
      }
      await screenshot(page, `probe-analysis-expanded-${size.width}x${size.height}`);
      await page.locator('#contents-analysis').evaluate(details => { details.open = false; });
      if (size.width < 700) await page.locator('#contents-close').click();
    });
  }
  if (!baseline && !probe) {
    await check('filter retains ancestors, leaves location and saved expansion unchanged', async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const before = await saved(page);
      await page.locator('#contents-search').fill('Chapter 24:');
      await page.locator('[data-node-id="part-3-chapter-5"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-node-id="part-0"]').isVisible(), false);
      assert.equal(await page.locator('[data-node-id="part-3"]').isVisible(), true);
      assert.equal(await page.locator('#page-input').inputValue(), '1');
      assert.deepEqual((await saved(page)).expanded, before.expanded);
      await screenshot(page, 'after-search-match');
      await page.locator('#contents-search').fill('nothing matches this title');
      await page.locator('#contents-empty').waitFor({ state: 'visible' });
      assert.match(await page.locator('#contents-empty').innerText(), /no|match/i);
      await screenshot(page, 'after-search-empty');
      await page.locator('#contents-clear').click();
      assert.equal(await page.locator('#contents-search').inputValue(), '');
      assert.deepEqual((await saved(page)).expanded, before.expanded);
    });
    await check('offscreen destination, active ancestors, collapse focus and persistence', async () => {
      await fixture(page);
      await page.locator('[data-node-id="part-3-chapter-5"]').click();
      await expectActive(page, 'part-3-chapter-5', 47);
      assert.ok(await page.locator('[data-node-id="part-3"]').evaluate(link => link.parentElement.classList.contains('active-parent')));
      const collapse = page.getByRole('button', { name: /^Collapse Part 4:/ });
      await collapse.focus();
      await collapse.press('Enter');
      assert.equal(await page.locator('[data-node-id="part-3-chapter-5"]').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded')), 'false');
      await waitForAsync(page, async () => {
        const { getBook } = await import('/src/storage.js');
        const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
        return book.contentsExpanded['part-3'] === false;
      }, undefined, { label: 'saved collapsed part' });
      await page.reload();
      await settledReader(page, 47);
      assert.equal(await page.locator('[data-node-id="part-3-chapter-5"]').isVisible(), false);
    });
    await check('Current section reveals active row without navigation, arrow keys stay in Contents', async () => {
      await fixture(page);
      await page.locator('[data-node-id="part-3-chapter-5"]').click();
      await expectActive(page, 'part-3-chapter-5', 47);
      await page.locator('#contents-search').fill('Chapter 2:');
      const before = await saved(page);
      await page.locator('#contents-current').click();
      assert.equal(await page.locator('#contents-search').inputValue(), '');
      const row = page.locator('[data-node-id="part-3-chapter-5"]');
      await row.waitFor({ state: 'visible' });
      assert.equal(await page.locator('#page-input').inputValue(), String(before.page));
      const after = await saved(page);
      assert.deepEqual(after.bookPosition, before.bookPosition);
      assert.deepEqual(after.scrollPosition, before.scrollPosition);
      const rowBox = await row.boundingBox(), listBox = await page.locator('#chapter-list').boundingBox();
      assert.ok(rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1, 'Current section did not reveal its row');
      await row.focus();
      await row.press('ArrowLeft');
      await row.press('ArrowRight');
      assert.equal(await page.locator('#page-input').inputValue(), String(before.page));
      await screenshot(page, 'after-current-section');
    });
    await check('PDF bookmarks stay separate and saved reader bookmarks survive navigation', async () => {
      await fixture(page);
      const details = page.locator('.page-bookmarks');
      await details.locator('summary').click();
      const destination = page.locator('[data-page-bookmark="pdf-bookmark"]');
      assert.equal(await destination.getAttribute('data-node-id'), null);
      await destination.click();
      await settledReader(page, 17);
      assert.deepEqual((await saved(page)).bookmarks, [7, 19]);
    });
    await check('mobile focus containment, Escape from input, navigation close and resize cleanup', async () => {
      await fixture(page);
      await page.setViewportSize({ width: 390, height: 640 });
      await openDrawer(page);
      await page.waitForFunction(() => document.querySelector('#book-contents').contains(document.activeElement), undefined, { timeout: 3000 });
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => document.querySelector('#book-contents').contains(document.activeElement)), `Focus escaped after Tab ${i}`);
      }
      await page.locator('#contents-search').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#contents-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'contents-toggle');
      assert.equal(await page.locator('[inert]').count(), 0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await openDrawer(page);
      await page.waitForFunction(() => document.querySelector('#book-contents').contains(document.activeElement), undefined, { timeout: 3000 });
      await screenshot(page, 'after-mobile-normal-motion');
      await page.keyboard.press('Shift+Tab');
      assert.ok(await page.evaluate(() => document.querySelector('#book-contents').contains(document.activeElement)));
      await page.mouse.click(380, 350);
      assert.equal(await page.locator('#contents-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('[inert]').count(), 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openDrawer(page);
      await page.locator('[data-node-id="part-0-chapter-1"]').click();
      await settledReader(page, 3);
      assert.equal(await page.locator('#contents-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('[inert]').count(), 0);
      await openDrawer(page);
      await page.locator('#contents-close').focus();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => !document.body.classList.contains('contents-open'));
      assert.equal(await page.locator('[inert]').count(), 0);
      await page.locator('#page-input').focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'page-input');
      await page.locator('#contents-search').focus();
      await page.setViewportSize({ width: 390, height: 640 });
      await page.waitForFunction(() => document.activeElement?.id === 'contents-toggle');
      await page.setViewportSize({ width: 1440, height: 900 });
    });
    await check('help dialog interaction preserves underlying drawer and focus return', () => helpDialogKeepsDrawer(page));
    await fixture(page);
    for (const [viewport, size] of [['desktop', { width: 1440, height: 900 }], ['short', { width: 1000, height: 420 }], ['mobile', { width: 390, height: 640 }]]) {
      for (const mode of ['book', 'original']) for (const layout of ['scroll', 'pages']) for (const paper of ['light', 'dark']) {
        await check(`${viewport} ${mode} ${layout} ${paper}: usable outline and rendered destination`, async () => {
          await page.setViewportSize(size);
          if (await page.locator('#contents-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#contents-close').click();
          await page.locator(`#${mode}-view`).click();
          await page.locator(`#${layout}-layout`).click();
          if (await page.locator('body').evaluate(body => body.classList.contains('dark-paper')) !== (paper === 'dark')) await page.locator('#paper-button').click();
          await settledReader(page);
          await openDrawer(page);
          await page.locator('#contents-current').click();
          const geometry = await assertGeometry(page);
          await screenshot(page, `after-${viewport}-${mode}-${layout}-${paper}`);
          if (size.width < 700) await page.locator('#contents-close').click();
          return geometry;
        });
      }
    }
    await check('cancelled and no-heading complete UI states retain scan access', async () => {
      await page.setViewportSize({ width: 1000, height: 420 });
      await fixture(page, { status: 'cancelled', empty: true });
      await page.locator('#contents-analysis').locator('summary').click();
      await page.getByRole('button', { name: /Resume scan/i }).waitFor({ state: 'visible' });
      assert.match(await page.locator('#contents-analysis-label').innerText(), /stop|pause|resume/i);
      await screenshot(page, 'after-cancelled-synthetic');
      await fixture(page, { empty: true });
      await page.locator('#contents-empty').waitFor({ state: 'visible' });
      assert.doesNotMatch(await page.locator('#contents-empty').innerText(), /finding/i);
      await screenshot(page, 'after-no-headings-synthetic');
    });
    await check('synthetic analyzer scanning, stop, resume and error UI callbacks', async () => {
      // Replace only the served analyzer export. The real scanner and UI callbacks
      // run unchanged; these screenshots do not claim a real PDF analysis failure.
      await page.route('**/src/document-structure.js*', async route => {
        const response = await route.fetch();
        const source = await response.text();
        assert.ok(source.includes('export async function analyzeDocumentStructure('));
        await route.fulfill({ response, body: source.replace('export async function analyzeDocumentStructure(', 'async function originalAnalyzeDocumentStructure(') + `
export async function analyzeDocumentStructure(pdf, options) {
  if (globalThis.__contentsSyntheticAnalyzer === 'error') throw new Error('Synthetic analysis failure for Contents UI validation');
  if (globalThis.__contentsSyntheticAnalyzer === 'pending') return new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Synthetic scan stopped', 'AbortError')), { once: true });
  });
  return originalAnalyzeDocumentStructure(pdf, options);
}` });
      });
      await page.addInitScript(() => { globalThis.__contentsSyntheticAnalyzer = 'pending'; });
      try {
        await fixture(page, { status: 'cancelled', empty: true });
        await page.locator('#contents-analysis').locator('summary').click();
        await page.getByRole('button', { name: /Resume scan/i }).click();
        await page.getByRole('button', { name: /Stop scan/i }).waitFor({ state: 'visible' });
        assert.match(await page.locator('#contents-analysis-label').innerText(), /scan|finding|check/i);
        await screenshot(page, 'after-scanning-synthetic');
        await page.getByRole('button', { name: /Stop scan/i }).click();
        await page.getByRole('button', { name: /Resume scan/i }).waitFor({ state: 'visible' });
        await page.evaluate(() => { globalThis.__contentsSyntheticAnalyzer = 'error'; });
        await page.getByRole('button', { name: /Resume scan/i }).click();
        await waitForAsync(page, async () => {
          const { getBook } = await import('/src/storage.js');
          return (await getBook(JSON.parse(localStorage.getItem('folio:active-book')))).structure.status === 'error';
        }, undefined, { label: 'synthetic analyzer error persisted through real callbacks' });
        assert.match(await page.locator('#contents-analysis-label').innerText(), /error|pause|resume/i);
        await screenshot(page, 'after-error-synthetic');
      } finally { await page.unroute('**/src/document-structure.js*'); }
    });
    await check('632-node outline filters and clears without losing attached descendants', async () => {
      await page.evaluate(() => { globalThis.__contentsSyntheticAnalyzer = ''; });
      const started = performance.now();
      await fixture(page, { large: true });
      const loaded = performance.now() - started;
      assert.equal(await page.locator('[data-node-id]').count(), 632);
      const filterStarted = performance.now();
      await page.locator('#contents-search').fill('Research note 600:');
      await page.locator('[data-node-id="large-599"]').waitFor({ state: 'visible' });
      const filtered = performance.now() - filterStarted;
      assert.equal(await page.locator('[data-node-id]').count(), 632);
      assert.equal(await page.locator('[data-node-id="large-598"]').isVisible(), false);
      await screenshot(page, 'after-large-outline-filter');
      await page.locator('#contents-clear').click();
      assert.equal(await page.locator('[data-node-id]').count(), 632);
      assert.ok(filtered < 2000, `Single filter took ${Math.round(filtered)}ms`);
      return { syntheticNodes: 632, loadAndSettledReaderMs: Math.round(loaded), filterAndVisibleMatchMs: Math.round(filtered) };
    });
    await check('extreme short viewport keeps utility controls reachable', async () => {
      await page.setViewportSize({ width: 1000, height: 280 });
      await page.locator('#contents-analysis').scrollIntoViewIfNeeded();
      const box = await page.locator('#contents-analysis').boundingBox();
      assert.ok(box.y >= 0 && box.y < 280, 'Analysis controls stranded beyond clipped panel');
      await screenshot(page, 'after-extreme-short');
    });
  }
} catch (error) { report.errors.push(error.stack || error.message); }
finally {
  await context?.close();
  await server.close();
  await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ run, checks: report.checks.length, failed: report.checks.filter(check => check.pass === false), errors: report.errors, screenshots: report.screenshots.length }, null, 2));
if (report.errors.length || report.checks.some(check => check.pass === false)) process.exitCode = 1;
