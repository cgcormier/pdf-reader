/**
 * Real file-import/render acceptance checks, each selectable by audit issue.
 * node tests/structure-audit.browser.mjs [6|9|10|11|12|13|all]
 * Owns a fresh retained Chrome profile and an available loopback Vite origin.
 */
import assert from 'node:assert/strict';
import { captureReader } from './reader-capture.mjs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createServer as tcpServer } from 'node:net';
import { makeStructurePdf } from './structure-fixture.mjs';
import { makeLayoutPdf, modestHeadingPages, runningHeaderPages } from './pdf-layout-fixture.mjs';
import { makeProseAuditPdf, makeOpeningAuditPdf, makeDistantScrollAuditPdf, proseLines } from './audit-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = process.argv.slice(2).map(value => value.replace(/^#/, ''));
const selected = !issues.length || issues.includes('all') ? ['6', '9', '10', '11', '12', '13'] : issues;
assert.ok(selected.every(issue => ['6', '9', '10', '11', '12', '13'].includes(issue)), 'Supported issues: 6, 9, 10, 11, 12, 13, all');
const artifacts = path.join(root, 'output', 'playwright', 'structure-reconciliation');
await mkdir(artifacts, { recursive: true });
const runDirectory = await mkdtemp(path.join(artifacts, 'run-'));
const reserve = tcpServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const server = await createServer({ root, cacheDir: path.join(runDirectory, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }, clearScreen: false });
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
  if (label.includes('failure') || await page.locator('#modal').evaluate(n => n.open)) await page.screenshot({ path:path.join(runDirectory, `issue-${issue}-${label}.png`), fullPage:false });
  else await captureReader(page, path.join(runDirectory, `issue-${issue}-${label}.png`));
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

async function openingTitles(page) {
  for (const [name, bytes, label] of [
    ['Bundled sample.pdf', await readFile(path.join(root, 'public', 'sample.pdf')), 'sample'],
    ['Prefatory opening.pdf', makeOpeningAuditPdf(), 'prefatory'],
  ]) {
    await importPdf(page, name, bytes);
    const original = await savedBook(page);
    const canonical = await page.evaluate(async () => {
      const { getBook } = await import('/src/storage.js');
      const { openPdf } = await import('/src/pdf-engine.js');
      const { readPageLayout } = await import('/src/pdf-layout-adapter.js');
      const { conservation } = await import('/src/pdf-layout.js');
      const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
      const pdf = await openPdf(book.bytes.slice(0));
      try {
        const layout = await readPageLayout(pdf, 1);
        return { projection: layout.projection, conservation: conservation(layout),
          titleRole: layout.blocks.find(block => layout.projection.text.slice(block.start, block.end) === 'The First Light')?.role };
      } finally { await pdf.loadingTask.destroy(); }
    });
    assert.equal(canonical.conservation.valid, true, `${label}: source conservation`);
    if (label === 'prefatory') assert.ok(canonical.titleRole && canonical.titleRole !== 'heading', 'fixture must exercise imperfect title role');
    const titleNode = original.structure.nodes.find(node => node.title === 'The First Light');
    assert.ok(titleNode, `${label}: original outline title missing`);
    for (const mode of ['pages', 'scroll']) {
      await page.locator(`#${mode}-layout`).click();
      await page.locator('#page-input').fill('1'); await page.locator('#page-input').press('Enter');
      await settled(page);
      const prose = page.locator(mode === 'pages' ? '#book-spread .paper-page[data-source-page="1"] .page-prose' : '.scroll-page[data-source-page="1"] .page-prose').first();
      await prose.locator('.layout-block').first().waitFor();
      const text = await prose.textContent();
      assert.equal((text.match(/The First Light/g) ?? []).length, 1, `${label} ${mode}: duplicate opening title`);
      assert.equal((text.match(/CHAPTER ONE/g) ?? []).length, 1, `${label} ${mode}: source chapter number lost`);
      assert.equal(await prose.locator('.chapter-intro').count(), 0, `${label} ${mode}: injected title remains`);
      if (label === 'prefatory') assert.ok(text.includes('An opening note'), `${mode}: prefatory text lost`);
      if (mode === 'scroll') {
        const rendered = (await prose.locator('.layout-block').allTextContents()).join(' ').replace(/\s+/g, ' ').trim();
        assert.equal(rendered, canonical.projection.text.replace(/\s+/g, ' ').trim(), `${label}: body text changed`);
        assert.deepEqual(await prose.locator('..').evaluate(node => node.layoutModel.projection), canonical.projection, `${label}: rendering changed source projection`);
      }
      await capture(page, '12', `${label}-${mode}`);
    }
    await page.locator('#pages-layout').click();
    await page.setViewportSize({ width: 320, height: 640 });
    // Resizing schedules a debounced render; begin turns after it has settled.
    await new Promise(resolve => setTimeout(resolve, 200));
    await page.locator('#appearance-button').press('End');
    await page.locator('#page-input').fill('1'); await page.locator('#page-input').press('Enter');
    await settled(page);
    // Walk the actual fitted leaves and compare their intervals to the canonical
    // source; this detects dropped title/body text across continuation boundaries.
    const fragments = [];
    for (let turn = 0; turn < 80; turn++) {
      await settled(page);
      const leaf = page.locator('#book-spread > .paper-page').first();
      if (await leaf.getAttribute('data-source-page') !== '1') break;
      fragments.push(await leaf.locator('.layout-block').evaluateAll(blocks => blocks.map(block => ({
        start: Number(block.dataset.layoutStart), end: Number(block.dataset.layoutEnd), text: block.textContent,
      }))));
      if (await page.locator('#next-page').isDisabled()) break;
      await page.locator('#next-page').click();
    }
    const blocks = fragments.flat();
    assert.ok(fragments.length > 1, `${label}: continuation pagination was not exercised`);
    let previousEnd = 0;
    for (const block of blocks) {
      assert.ok(block.start >= previousEnd, `${label}: continuation repeated source text`);
      assert.equal(canonical.projection.text.slice(previousEnd, block.start).trim(), '', `${label}: continuation skipped source text`);
      assert.equal(block.text, canonical.projection.text.slice(block.start, block.end), `${label}: continuation changed text`);
      previousEnd = block.end;
    }
    assert.equal(canonical.projection.text.slice(previousEnd).trim(), '', `${label}: continuation lost final source text`);
    await page.locator('#previous-page').click(); await settled(page);
    const place = await waitForBook(page, book => book.bookPosition?.offset > 0 && book.bookPosition.source);
    const anchor = place.bookPosition;
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#modal').open && document.querySelector('#book-type').textContent === 'FROM YOUR SHELF');
    await settled(page);
    const restored = await savedBook(page);
    assert.deepEqual(restored.bookPosition, anchor, `${label}: continuation anchor changed on reload`);
    assert.equal(Number(await page.locator('#book-spread > .paper-page').first().getAttribute('data-text-offset')), anchor.offset, `${label}: rendered continuation not restored`);
    assert.deepEqual(Buffer.from(restored.bytes), Buffer.from(original.bytes), `${label}: original bytes changed`);
    await capture(page, '12', `${label}-continuation-restored`);
    await page.setViewportSize({ width: 1440, height: 960 });
    await new Promise(resolve => setTimeout(resolve, 200));
    await settled(page);
    await page.locator(`[data-node-id="${titleNode.id}"]`).click(); await settled(page);
    await waitForBook(page, book => book.bookPosition?.contentsId === titleNode.id);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#modal').open && document.querySelector('#book-type').textContent === 'FROM YOUR SHELF');
    await settled(page);
    assert.equal(await page.locator(`[data-node-id="${titleNode.id}"]`).getAttribute('aria-current'), 'location', `${label}: selected Contents not restored`);
    assert.equal(await page.locator('#current-chapter').textContent(), 'The First Light');
    report.push(`PASS #12 ${label}: one source title in both layouts, chapter/body conserved, ${fragments.length} continuation leaves, saved/reloaded source anchor, Contents selection and original bytes retained.`);
  }
}

async function modestHeadings(page) {
  await importPdf(page, 'Modest source headings.pdf', makeLayoutPdf(modestHeadingPages));
  const book = await savedBook(page);
  const expected = modestHeadingPages.flatMap((source, index) => source.items.slice(10, index ? 12 : 11)
    .map(item => ({ title: item.text.replace(/'/g, '\u2019'), page: index + 1, y: item.y, size: item.size })));
  assert.deepEqual(book.structure.nodes.map(node => [node.title, node.page]), expected.map(node => [node.title, node.page]));
  book.structure.nodes.forEach((node, index) => assert.ok(Math.abs(node.y - expected[index].y) < .001, 'heading source baseline changed'));
  const [prologue, speeches, section] = book.structure.nodes;
  assert.equal(prologue.parentId, null); assert.equal(speeches.parentId, null);
  assert.equal(section.parentId, speeches.id); assert.equal(section.kind, 'section');
  assert.deepEqual(book.chapters.map(chapter => chapter.title), [prologue.title, speeches.title]);
  for (const node of book.structure.nodes) assert.ok(node.sourceLineId && node.regionId, 'source heading identity missing');
  for (const mode of ['pages', 'scroll']) {
    await page.locator(`#${mode}-layout`).click(); await settled(page);
    if (mode === 'scroll') {
      for (const sourcePage of [1, 2]) {
        await page.locator('#page-input').fill(String(sourcePage)); await page.locator('#page-input').press('Enter');
        const paper = page.locator(`.scroll-page[data-source-page="${sourcePage}"]`);
        await paper.locator('.layout-heading').first().waitFor();
        const layout = await paper.evaluate(async node => {
          const { conservation, sourceAt, offsetForSource } = await import('/src/pdf-layout.js');
          const layout = node.layoutModel;
          return { text: layout.projection.text, conservation: conservation(layout),
            headings: layout.blocks.filter(block => block.role === 'heading').map(block => {
              const line = block.lines[0]; const source = sourceAt(layout.projection, block.start);
              return { text: layout.projection.text.slice(block.start, block.end), size: line.size,
                y: line.sourceY, source, expectedItem: line.runs[0].index,
                offset: block.start, back: offsetForSource(layout.projection, source) };
            }) };
        });
        assert.equal(layout.conservation.valid, true);
        const titles = expected.filter(node => node.page === sourcePage);
        assert.deepEqual(layout.headings.map(node => [node.text, node.size]), titles.map(node => [node.title, node.size]));
        layout.headings.forEach((node, index) => assert.ok(Math.abs(node.y - titles[index].y) < .001, 'rendered heading source baseline changed'));
        for (const heading of layout.headings) {
          assert.deepEqual(heading.source, { item: heading.expectedItem, offset: 0 });
          assert.equal(heading.back, heading.offset);
        }
        const rendered = (await paper.locator('.page-prose .layout-block').allTextContents()).join(' ').replace(/\s+/g, ' ').trim();
        assert.equal(rendered, layout.text.replace(/\s+/g, ' ').trim(), 'modest headings or body text changed');
        assert.equal(await paper.locator('.chapter-intro').count(), 0, 'mid-page source heading duplicated by injected intro');
      }
    }
    for (const node of book.structure.nodes) {
      const parent = node.parentId && page.locator(`[aria-controls="contents-group-${node.parentId}"]`);
      if (parent && await parent.getAttribute('aria-expanded') !== 'true') await parent.click();
      await page.locator(`[data-node-id="${node.id}"]`).click(); await settled(page);
      const saved = await waitForBook(page, current => current.bookPosition?.contentsId === node.id);
      assert.equal(saved.page, node.page); assert.ok(saved.bookPosition.offset > 0, 'mid-page heading source anchor missing');
      assert.equal(await page.locator(`[data-node-id="${node.id}"]`).getAttribute('aria-current'), 'location');
      assert.equal(await page.locator('#current-chapter').textContent(), node.title);
      const prose = page.locator(mode === 'pages' ? '#book-spread .page-prose' : `.scroll-page[data-source-page="${node.page}"] .page-prose`);
      const text = (await prose.allTextContents()).join(' ').replace(/\s+/g, ' ');
      assert.equal(text.split(node.title).length - 1, 1, `${mode}: modest source title duplicated or missing`);
      const headingText = (await prose.locator('.layout-heading').allTextContents()).join(' ').replace(/\s+/g, ' ');
      assert.equal(headingText.split(node.title).length - 1, 1, `${mode}: modest title lacks heading role`);
    }
    await capture(page, '10', mode);
  }
  report.push('PASS #10: three modest source headings retain exact text and anchors; two Contents roots and their small-capitals section navigate in both layouts without duplicate mid-page titles.');
}

async function chapterReconciliation(page) {
  await distantScrollJump(page);
  for (const [name, bytes, label] of [
    ['Reconciled sample.pdf', await readFile(path.join(root, 'public', 'sample.pdf')), 'sample'],
    ['Reconciled prefatory.pdf', makeOpeningAuditPdf(), 'prefatory'],
  ]) {
    await importPdf(page, name, bytes);
    const book = await savedBook(page);
    const outlines = await page.evaluate(async () => {
      const { getBook } = await import('/src/storage.js');
      const { openPdf } = await import('/src/pdf-engine.js');
      const { readDocumentStructure } = await import('/src/document-structure.js');
      const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
      const pdf = await openPdf(book.bytes.slice(0));
      try { return (await readDocumentStructure(pdf)).nodes.filter(node => node.source === 'outline'); }
      finally { await pdf.loadingTask.destroy(); }
    });
    const expected = label === 'sample' ? [
      ['The First Light', 1, 735, 'chapter'], ['A quiet continuation.', 2, 735, 'heading'], ['A Slower Morning', 3, 735, 'chapter'],
    ] : [['The First Light', 1, 715, 'chapter']];
    assert.deepEqual(book.structure.nodes.map(node => [node.title, node.page, node.y, node.kind]), expected, `${label}: duplicate or inconsistent chapter nodes`);
    assert.ok(book.structure.nodes.every(node => node.parentId === null), `${label}: unjustified chapter hierarchy`);
    for (const outline of outlines) {
      const reconciled = book.structure.nodes.find(node => node.id === outline.id);
      assert.ok(reconciled, `${label}: original outline identity lost`);
      assert.equal(reconciled.title, outline.title, `${label}: original outline title changed`);
    }
    assert.deepEqual(book.structure.nodes.filter(node => node.kind === 'chapter').map(node => node.chapterNumber), label === 'sample' ? ['1', '2'] : ['1']);
    assert.deepEqual(book.chapters.map(chapter => [chapter.title, chapter.page, chapter.kind]), expected.map(([title, sourcePage, , kind]) => [title, sourcePage, kind]), `${label}: stored chapter metadata disagrees with Contents`);
    assert.equal(await page.locator('[data-node-id]').count(), expected.length, `${label}: duplicate rendered Contents rows`);
    assert.deepEqual(await page.locator('[data-node-id] .chapter-label').allTextContents(), expected.map(([title]) => title));
    for (const mode of ['pages', 'scroll']) {
      await page.locator(`#${mode}-layout`).click(); await settled(page);
      for (const node of book.structure.nodes) {
        await page.locator(`[data-node-id="${node.id}"]`).click(); await settled(page);
        await waitForBook(page, current => current.bookPosition?.contentsId === node.id && current.bookPosition.source);
        // Scroll captures the visible source after its final layout callback.
        if (mode === 'scroll') await new Promise(resolve => setTimeout(resolve, 800));
        const before = await savedBook(page);
        assert.equal(before.page, node.page);
        assert.equal(await page.locator('#current-chapter').textContent(), node.title);
        assert.equal(await page.locator(`[data-node-id="${node.id}"]`).getAttribute('aria-current'), 'location');
        const prose = page.locator(mode === 'pages' ? `#book-spread .paper-page[data-source-page="${node.page}"] .page-prose` : `.scroll-page[data-source-page="${node.page}"] .page-prose`);
        const displayed = (await prose.allTextContents()).join(' ').replace(/\s+/g, ' ');
        assert.equal(displayed.split(node.title).length - 1, 1, `${label} ${mode}: canonical chapter title duplicated or missing`);
        assert.equal(await prose.locator('.chapter-intro').count(), 0, `${label} ${mode}: injected chapter intro disagrees with source opening`);
        if (label === 'prefatory' && mode === 'scroll') await capture(page, '13', 'prefatory-scroll-before-reload');
        await page.reload();
        await page.waitForFunction(() => !document.querySelector('#modal').open && document.querySelector('#book-type').textContent === 'FROM YOUR SHELF');
        await settled(page);
        if (mode === 'scroll') await new Promise(resolve => setTimeout(resolve, 800));
        const after = await savedBook(page);
        if (JSON.stringify(after.bookPosition.source) !== JSON.stringify(before.bookPosition.source)) {
          await writeFile(path.join(runDirectory, `issue-13-${label}-${mode}-anchor.json`), JSON.stringify({
            before: before.bookPosition, after: after.bookPosition,
            geometry: await page.locator('#scroll-stage').evaluate(stage => ({ top: stage.getBoundingClientRect().top,
              scrollTop: stage.scrollTop, blocks: [...stage.querySelectorAll('.layout-block')].map(block => ({
                text: block.textContent.slice(0, 80), start: block.dataset.layoutStart,
                top: block.getBoundingClientRect().top, bottom: block.getBoundingClientRect().bottom,
              })) })),
          }, null, 2));
        }
        assert.equal(after.page, before.page, `${label} ${mode}: selected destination moved page`);
        assert.deepEqual(after.bookPosition.source, before.bookPosition.source, `${label} ${mode}: selected source anchor changed`);
        assert.equal(after.bookPosition.contentsId, node.id, `${label} ${mode}: selected destination ID lost`);
        assert.equal(await page.locator(`[data-node-id="${node.id}"]`).getAttribute('aria-current'), 'location', `${label} ${mode}: selected Contents row not restored`);
        assert.equal(await page.locator('#current-chapter').textContent(), node.title);
        assert.deepEqual(after.structure.nodes, book.structure.nodes, `${label}: reload changed reconciled identities`);
        assert.deepEqual(Buffer.from(after.bytes), Buffer.from(book.bytes), `${label}: reconciliation changed original bytes`);
      }
      await capture(page, '13', `${label}-${mode}`);
    }
    report.push(`PASS #13 ${label}: coherent chapter titles and Contents preserve outline IDs; every destination restores selection and source anchor in both layouts without changing PDF bytes.`);
  }
}

async function distantScrollJump(page) {
  await importPdf(page, 'Distant scroll destinations.pdf', makeDistantScrollAuditPdf());
  const original = await savedBook(page);
  const destination = original.structure.nodes.find(node => node.page === 17 && node.kind === 'chapter');
  assert.ok(destination, 'distant source chapter missing');
  await page.locator('#pages-layout').click(); await settled(page);
  await page.locator('#appearance-button').press('Home');
  for (let step = 0; step < 7; step++) await page.locator('#appearance-button').press('ArrowRight');
  await page.locator('#page-input').fill('4'); await page.locator('#page-input').press('Enter'); await settled(page);
  await page.locator('#scroll-layout').click(); await settled(page);
  await page.locator('#page-input').fill('17'); await page.locator('#page-input').press('Enter');
  await page.locator('#page-input').blur();
  const snapshot = () => page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    const stage = document.querySelector('#scroll-stage'); const readingY = stage.getBoundingClientRect().top + 18;
    const pages = [...stage.querySelectorAll('.scroll-page')].map(node => ({
      page: Number(node.dataset.sourcePage), top: node.getBoundingClientRect().top,
      bottom: node.getBoundingClientRect().bottom, height: node.getBoundingClientRect().height,
    }));
    return { savedPage: book.page, inputPage: document.querySelector('#page-input').value,
      position: book.bookPosition, readingY, visiblePage: pages.find(node => node.top <= readingY && node.bottom > readingY)?.page,
      activeLoads: stage.dataset.activeLoads, scrollTop: stage.scrollTop, scrollHeight: stage.scrollHeight, pages };
  });
  const trace = [];
  for (let frame = 0; frame < 10; frame++) {
    trace.push(await snapshot()); await new Promise(resolve => setTimeout(resolve, 100));
  }
  await page.waitForFunction(() => document.querySelector('#scroll-stage').dataset.activeLoads === '0');
  await new Promise(resolve => setTimeout(resolve, 850));
  trace.push(await snapshot());
  await writeFile(path.join(runDirectory, 'issue-13-distant-scroll-trace.json'), JSON.stringify(trace, null, 2));
  const final = trace.at(-1);
  await capture(page, '13', 'distant-scroll-jump');
  assert.equal(final.savedPage, 17, 'distant Scroll jump changed the saved source page');
  assert.equal(final.visiblePage, 17, 'distant Scroll target is mounted outside the reading line');
  assert.ok(trace.every(frame => frame.pages.length <= 7), 'distant jump exceeded mounted page limit');
  await page.locator(`[data-node-id="${destination.id}"]`).click(); await settled(page);
  await waitForBook(page, book => book.bookPosition?.contentsId === destination.id && book.bookPosition.source);
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal((await snapshot()).visiblePage, 17, 'distant Contents target is outside the reading line');
  const before = await savedBook(page);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#modal').open && document.querySelector('#book-type').textContent === 'FROM YOUR SHELF');
  await settled(page);
  await page.waitForFunction(() => document.querySelector('#scroll-stage').dataset.activeLoads === '0');
  await new Promise(resolve => setTimeout(resolve, 850));
  const after = await savedBook(page);
  assert.equal((await snapshot()).visiblePage, 17, 'distant source anchor did not restore at the reading line');
  assert.equal(after.page, 17);
  assert.equal(after.bookPosition.contentsId, destination.id);
  assert.deepEqual(after.bookPosition.source, before.bookPosition.source, 'distant source anchor changed on reload');
  assert.equal(await page.locator(`[data-node-id="${destination.id}"]`).getAttribute('aria-current'), 'location');
  assert.deepEqual(Buffer.from(after.bytes), Buffer.from(original.bytes));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const target of [1, 17]) {
    await page.locator('#page-input').fill(String(target)); await page.locator('#page-input').press('Enter');
    await page.locator('#page-input').blur();
    await page.waitForFunction(() => document.querySelector('#scroll-stage').dataset.activeLoads === '0');
    await new Promise(resolve => setTimeout(resolve, 850));
    const position = await snapshot();
    assert.equal(position.savedPage, target, 'ordinary-motion distant jump changed saved page');
    assert.equal(position.visiblePage, target, 'ordinary-motion distant jump missed reading line');
    assert.ok(position.pages.length <= 7, 'ordinary-motion jump exceeded mounted page limit');
  }
  await capture(page, '13', 'distant-scroll-ordinary-motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  report.push('PASS #13 distant Scroll: reduced-motion jump17 and selected Contents/source-anchor reload; ordinary-motion jumps1/17; visible/saved destinations and mounted-page bounds retained.');
}

async function sourceHeaders(page) {
  await importPdf(page, 'Running source headers.pdf', makeLayoutPdf(runningHeaderPages));
  const models = await page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const { openPdf } = await import('/src/pdf-engine.js');
    const { readPageLayout } = await import('/src/pdf-layout-adapter.js');
    const { conservation, sourceAt, offsetForSource } = await import('/src/pdf-layout.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    const pdf = await openPdf(book.bytes.slice(0)); const models = [];
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        const layout = await readPageLayout(pdf, number);
        models.push({ text: layout.projection.text, conservation: conservation(layout),
          annotations: layout.annotations.map(annotation => ({ text: annotation.projection.text,
            role: annotation.role, sourceLine: annotation.associatedLine,
            runs: annotation.lines.flatMap(line => line.runs).filter(run => run.text.trim()).map(run => {
              const first = offsetForSource(annotation.projection, { item: run.index, offset: 0 });
              const last = offsetForSource(annotation.projection, { item: run.index, offset: run.text.length - 1 });
              return { item: run.index, text: run.text,
                first: sourceAt(annotation.projection, first), last: sourceAt(annotation.projection, last),
                retained: annotation.projection.text.slice(first, last + 1) };
            }) })) });
      }
      return models;
    } finally { await pdf.loadingTask.destroy(); }
  });
  for (const [index, model] of models.entries()) {
    assert.equal(model.conservation.valid, true, `page ${index + 1}: source conservation`);
    assert.equal(model.text, runningHeaderPages[index].items.slice(-6).map(item => item.text).join(' '));
    assert.ok(model.annotations.length && model.annotations.every(annotation => annotation.role === 'running-header'));
    for (const annotation of model.annotations) for (const run of annotation.runs) {
      assert.deepEqual(run.first, { item: run.item, offset: 0 });
      assert.deepEqual(run.last, { item: run.item, offset: run.text.length - 1 });
      assert.equal(run.retained, run.text, 'header source text changed');
    }
    for (const header of runningHeaderPages[index].items.slice(0, -6)) {
      assert.ok(model.annotations.some(annotation => annotation.text.includes(header.text)), 'original header missing from source annotations');
    }
  }
  for (const mode of ['pages', 'scroll']) {
    await page.locator(`#${mode}-layout`).click(); await settled(page);
    for (const [index, model] of models.entries()) {
      const number = index + 1;
      await page.locator('#page-input').fill(String(number)); await page.locator('#page-input').press('Enter');
      await settled(page);
      const paper = page.locator(mode === 'pages' ? `#book-spread > .paper-page[data-source-page="${number}"]` : `.scroll-page[data-source-page="${number}"]`).first();
      await paper.locator('.layout-block').first().waitFor();
      const prose = (await paper.locator('.page-prose .layout-block').allTextContents()).join(' ').replace(/\s+/g, ' ').trim();
      assert.equal(prose, model.text, `${mode} page ${number}: header leaked or body prose lost`);
      assert.doesNotMatch(prose, /THUS SPOKE|FIRST PART|nRST P\.ART|\?ORTABLE|ZARATH USTRA|\b12[134]\b|\b137\b/);
      await paper.locator('.layout-source-notes').click();
      await page.locator('#modal[open] .layout-annotations').waitFor();
      await page.locator('#modal .layout-annotations summary').click();
      assert.deepEqual(await page.locator('#modal .layout-annotations p').allTextContents(), model.annotations.map(annotation => annotation.text), `${mode} page ${number}: Source notes text changed`);
      assert.deepEqual(await page.locator('#modal .layout-annotations p').evaluateAll(notes => notes.map(note => note.dataset.sourceLine)), model.annotations.map(annotation => annotation.sourceLine ?? ''), `${mode}: source note association changed`);
      if (number === 4) await capture(page, '11', `${mode}-source-notes`);
      await page.locator('#modal-close').click();
    }
    await capture(page, '11', mode);
  }
  report.push('PASS #11: five combined, split, OCR-shaped and offset source headers remain out of prose in both layouts; exact body and Source notes text, associations and header source endpoint maps retained.');
}

try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(typeof address === 'object' && address.port !== 4173, 'must use isolated origin');
  console.log(`Isolated origin http://127.0.0.1:${address.port}; ${runDirectory}`);
  context = await chromium.launchPersistentContext(path.join(runDirectory, 'profile'), {
    channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome', headless: true,
    viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce',
  });
  for (const issue of selected) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${address.port}`;
    await page.goto(`${origin}/tests/fidelity-check.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('demo')));
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('#appearance-button[aria-valuenow]').waitFor({ timeout: 90000 });
    await page.waitForFunction(() => document.body.classList.contains('scroll-mode')
      ? document.querySelector('#scroll-stage').dataset.activeLoads === '0'
      : document.querySelector('#book-spread').getAttribute('aria-busy') === 'false');
    try {
      await ({ 6: scannerBookmarks, 9: proseHeadings, 10: modestHeadings, 11: sourceHeaders, 12: openingTitles, 13: chapterReconciliation }[issue])(page);
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
