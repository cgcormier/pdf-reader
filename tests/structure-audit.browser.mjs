/**
 * Real file-import/render acceptance checks, each selectable by audit issue.
 * node tests/structure-audit.browser.mjs [6|9|all]
 * Owns a fresh retained Chrome profile and a random loopback Vite origin.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { makeStructurePdf } from './structure-fixture.mjs';
import { makeProseAuditPdf, proseLines } from './audit-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = process.argv.slice(2).map(value => value.replace(/^#/, ''));
const selected = !issues.length || issues.includes('all') ? ['6', '9'] : issues;
assert.ok(selected.every(issue => ['6', '9'].includes(issue)), 'Supported issues: 6, 9, all');
const artifacts = path.join(root, 'output', 'playwright', 'structure-reconciliation');
await mkdir(artifacts, { recursive: true });
const runDirectory = await mkdtemp(path.join(artifacts, 'run-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, clearScreen: false });
let context;
const report = [];
const errors = [];

async function savedBook(page) {
  return page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return { ...book, bytes: Array.from(new Uint8Array(book.bytes)) };
  });
}

async function waitForBook(page, predicate) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const book = await savedBook(page);
    if (predicate(book)) return book;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for saved book metadata');
}

async function importPdf(page, name, bytes) {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => !document.querySelector('#modal').open
    && document.querySelector('#book-type')?.textContent === 'FROM YOUR SHELF');
  await waitForBook(page, book => book?.filename === name && book.structure.status === 'complete');
  await settled(page);
}

async function settled(page) {
  await page.waitForFunction(() => document.body.classList.contains('scroll-mode')
    ? Boolean(document.querySelector('.scroll-page .layout-block'))
    : document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'
      && Boolean(document.querySelector('#book-spread .layout-block')));
}

async function capture(page, issue, label) {
  await page.screenshot({ path: path.join(runDirectory, `issue-${issue}-${label}.png`), fullPage: true });
}

async function scannerBookmarks(page) {
  await importPdf(page, 'Scanner page bookmarks.pdf', makeStructurePdf({ outline: 'scan-pages', pages: 12 }));
  const book = await savedBook(page);
  assert.equal(book.structure.pageNavigation.length, 12, 'all scanner destinations retained');
  assert.ok(book.structure.nodes.every(node => !/^\d+$/.test(node.title)), 'numeric destinations excluded from semantic nodes');
  assert.equal(await page.locator('details.page-bookmarks [data-page-bookmark]').count(), 12);
  assert.equal(await page.locator('[data-node-id]').evaluateAll(nodes => nodes.filter(node => /^\d+$/.test(node.querySelector('.chapter-label').textContent)).length), 0);
  const title = await page.locator('#book-title').textContent();
  for (const mode of ['pages', 'scroll']) {
    await page.locator(`#${mode}-layout`).click();
    await settled(page);
    const details = page.locator('details.page-bookmarks');
    if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
    assert.ok(await details.locator('.chapter-label').evaluateAll(labels => labels.every(label => {
      const range = document.createRange(); range.selectNodeContents(label);
      return range.getClientRects().length === 1;
    })), `${mode}: scanner label wrapped onto multiple lines`);
    const destination = book.structure.pageNavigation[6];
    await page.locator(`[data-page-bookmark="${destination.id}"]`).click();
    await page.waitForFunction(() => document.querySelector('#page-input').value === '7');
    await settled(page);
    assert.equal(await page.locator('#book-title').textContent(), title, `${mode}: bookmark changed book title`);
    assert.doesNotMatch(await page.locator('#current-chapter').textContent(), /^\s*\d+\s*$/, `${mode}: bookmark became chapter identity`);
    assert.equal((await savedBook(page)).page, 7, `${mode}: destination was not persisted`);
    await capture(page, '6', mode);
  }
  await page.locator('#pages-layout').click();
  await settled(page);
  const before = await savedBook(page);
  // Leave the reader before seeding old metadata so pagehide saves cannot race
  // the fixture. This existing test page is inert until its Run button is used.
  await page.goto(new URL('/tests/layout-check.html', page.url()).href);
  await page.evaluate(async () => {
    const { getBook, updateBook } = await import('/src/storage.js');
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    const book = await getBook(id);
    const { pageNavigation, ...structure } = book.structure;
    await updateBook(id, { structure: { ...structure, version: 5, nodes: pageNavigation, status: 'complete' },
      chapters: pageNavigation.map(node => ({ title: node.title, page: node.page })) });
  });
  await page.goto(new URL('/', page.url()).href);
  await page.waitForFunction(() => !document.querySelector('#modal').open
    && document.querySelector('#book-type')?.textContent === 'FROM YOUR SHELF');
  await waitForBook(page, book => book?.structure.version > 5 && book.structure.status === 'complete'
      && book.structure.pageNavigation?.length === 12
      && book.chapters.every(chapter => !/^\d+$/.test(chapter.title)));
  await settled(page);
  const upgraded = await savedBook(page);
  await writeFile(path.join(runDirectory, 'issue-6-upgrade.json'), JSON.stringify({ structure: upgraded.structure, chapters: upgraded.chapters, bookPosition: upgraded.bookPosition }, null, 2));
  assert.equal(upgraded.structure.pageNavigation.length, 12, 'upgrade lost scanner destinations');
  assert.ok(upgraded.chapters.every(chapter => !/^\d+$/.test(chapter.title)), 'upgrade retained stale numeric chapter metadata');
  assert.equal(upgraded.page, before.page, 'upgrade moved source page');
  assert.equal(upgraded.bookPosition.offset, before.bookPosition.offset, 'upgrade moved source anchor');
  if (before.bookPosition.source) assert.deepEqual(upgraded.bookPosition.source, before.bookPosition.source, 'upgrade changed source identity');
  assert.deepEqual(Buffer.from(upgraded.bytes), Buffer.from(before.bytes), 'upgrade changed original PDF bytes');
  assert.doesNotMatch(await page.locator('#current-chapter').textContent(), /^\s*\d+\s*$/);
  assert.ok((await page.locator('.chapter-intro .chapter-title').allTextContents()).every(text => !/^\s*\d+\s*$/.test(text)), 'upgrade kept numeric chapter intro');
  await capture(page, '6', 'upgraded');
  report.push('PASS #6: scanner bookmarks navigate separately in both modes; stale v5 chapters upgrade without numeric identities, changed bytes or moved source anchors.');
}

async function proseHeadings(page) {
  await importPdf(page, 'Structural words in prose.pdf', makeProseAuditPdf());
  for (const mode of ['pages', 'scroll']) {
    await page.locator(`#${mode}-layout`).click();
    await settled(page);
    const prose = page.locator(mode === 'pages' ? '#book-spread .page-prose' : '.scroll-page[data-source-page="1"] .page-prose').first();
    const rendered = (await prose.locator('.layout-block').allTextContents()).join(' ').replace(/\s+/g, ' ').trim();
    assert.equal(rendered, proseLines.join(' '), `${mode}: original prose changed or disappeared`);
    for (const phrase of [proseLines[1], 'book of stories']) {
      const block = prose.locator('.layout-block').filter({ hasText: phrase });
      assert.equal(await block.count(), 1, `${mode}: phrase has ambiguous blocks`);
      assert.equal(await block.evaluate(node => node.tagName), 'P', `${mode}: prose promoted to heading`);
    }
    assert.equal(await prose.locator('h3.layout-block').count(), 0, `${mode}: invented heading remains`);
    await capture(page, '9', mode);
  }
  const map = await page.locator('.scroll-page[data-source-page="1"]').evaluate(async (node, lines) => {
    const { sourceAt, offsetForSource } = await import('/src/pdf-layout.js');
    const layout = node.layoutModel;
    return lines.map(text => {
      const offset = layout.projection.text.indexOf(text);
      const source = sourceAt(layout.projection, offset);
      const run = layout.runs.find(run => run.index === source?.item);
      return { text, offset, source, runText: run?.text,
        back: offsetForSource(layout.projection, source),
        end: offsetForSource(layout.projection, { item: source?.item, offset: text.length - 1 }) };
    });
  }, proseLines);
  for (const entry of map) {
    assert.ok(entry.offset >= 0 && entry.source, 'prose source mapping missing');
    assert.equal(entry.runText, entry.text, 'prose source run changed');
    assert.equal(entry.source.offset, 0);
    assert.equal(entry.back, entry.offset);
    assert.equal(entry.end, entry.offset + entry.text.length - 1);
  }
  const book = await savedBook(page);
  assert.ok(!book.structure.nodes.some(node => /^(part of their load|book of stories)/i.test(node.title)), 'prose became Contents heading');
  report.push('PASS #9: exact structural-word prose renders as paragraphs in both modes; every source line and first/last-character source mapping retained.');
}

try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(typeof address === 'object' && address.port !== 4173, 'must use isolated origin');
  context = await chromium.launchPersistentContext(path.join(runDirectory, 'profile'), {
    channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome', headless: true,
    viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce',
  });
  for (const issue of selected) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${address.port}`;
    await page.goto(`${origin}/tests/layout-check.html`);
    await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('demo')));
    await page.goto(`${origin}/`);
    await page.locator('#file-input').waitFor({ state: 'attached' });
    try {
      await ({ 6: scannerBookmarks, 9: proseHeadings }[issue])(page);
    } catch (error) {
      await capture(page, issue, 'failure');
      throw error;
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, [], 'renderer errors');
  console.log(report.join('\n'));
  console.log(`Evidence and isolated profile retained: ${runDirectory}`);
} finally {
  await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify({ issues: selected, report, errors }, null, 2));
  await context?.close();
  await server.close();
}
