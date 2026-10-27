/** Real import and rendered regressions on a fresh retained profile/origin.
 * node tests/fidelity-audit.browser.mjs [14|15|16|17|all]
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { makeEmphasisPdf, makeSpeechPdf, makeOcrPdf, makeTailPdf } from './fidelity-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).map(value => value.replace(/^#/, ''));
const selected = !args.length || args.includes('all') ? ['14', '15', '16', '17'] : args;
assert.ok(selected.every(issue => ['14', '15', '16', '17'].includes(issue)), 'Supported issues: 14, 15, 16, 17, all');
const artifacts = path.join(root, 'output', 'playwright', 'reader-fidelity');
await mkdir(artifacts, { recursive: true });
const runDirectory = await mkdtemp(path.join(artifacts, 'run-'));
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, clearScreen: false });
let context;
const report = []; const errors = []; const evidence = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const compact = text => text.replace(/\s+/g, ' ').trim();

async function savedBook(page) {
  return page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return { ...book, bytes: Array.from(new Uint8Array(book.bytes)) };
  });
}
async function settled(page) {
  await page.waitForFunction(() => document.body.classList.contains('scroll-mode')
    ? document.querySelector('#scroll-stage')?.dataset.activeLoads === '0'
      && Boolean(document.querySelector('.scroll-page .layout-block, .scroll-page canvas'))
    : document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'
      && Boolean(document.querySelector('#book-spread .layout-block, #book-spread canvas')));
}
async function importPdf(page, name, bytes) {
  await writeFile(path.join(runDirectory, name), bytes);
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => !document.querySelector('#modal').open
    && document.querySelector('#book-type')?.textContent === 'FROM YOUR SHELF');
  await page.waitForFunction(async filename => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return book?.filename === filename && book.structure?.status === 'complete';
  }, name, { timeout: 60_000 });
  await settled(page);
}
async function capture(page, issue, label) {
  await page.screenshot({ path: path.join(runDirectory, `issue-${issue}-${label}.png`), fullPage: true });
}
async function size(page, viewport, value) {
  await page.setViewportSize(viewport); await pause(250);
  await page.locator('#appearance-button').press('Home');
  for (let step = 6; step < value; step++) await page.locator('#appearance-button').press('ArrowRight');
  await pause(250); await settled(page);
}
async function jump(page, number) {
  await page.locator('#page-input').fill(String(number)); await page.locator('#page-input').press('Enter');
  await page.locator('#page-input').blur(); await settled(page);
}
async function models(page, pages) {
  return page.evaluate(async requested => {
    const { getBook } = await import('/src/storage.js');
    const { openPdf } = await import('/src/pdf-engine.js');
    const { readPageLayout } = await import('/src/pdf-layout-adapter.js');
    const { conservation, sourceAt, offsetForSource } = await import('/src/pdf-layout.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    const pdf = await openPdf(book.bytes.slice(0)); const result = [];
    try {
      for (const number of requested) {
        const model = await readPageLayout(pdf, number);
        const maps = model.projection.segments.filter(segment => segment.source && !segment.transform).flatMap(segment =>
          [segment.start, segment.end - 1].map(offset => ({ offset, source: sourceAt(model.projection, offset),
            back: offsetForSource(model.projection, sourceAt(model.projection, offset)) })));
        result.push({ number, model, conservation: conservation(model), maps });
      }
    } finally { await pdf.loadingTask.destroy(); }
    return result;
  }, pages);
}
function conserved(entries) {
  for (const entry of entries) {
    assert.equal(entry.conservation.valid, true, `page ${entry.number}: source conservation`);
    for (const map of entry.maps) assert.equal(map.back, map.offset, `page ${entry.number}: source endpoint roundtrip`);
  }
}
async function snapshot(page, scrollPage) {
  return page.evaluate(number => {
    const selector = document.body.classList.contains('scroll-mode')
      ? `.scroll-page[data-source-page="${number}"]` : '#book-spread > .paper-page';
    return [...document.querySelectorAll(selector)].map(leaf => {
      const prose = leaf.querySelector('.page-prose'); const bounds = prose.getBoundingClientRect();
      return { page: Number(leaf.dataset.sourcePage), start: Number(leaf.dataset.textOffset || 0),
        end: Number(leaf.dataset.textEnd || leaf.layoutModel?.projection.text.length || 0),
        proseHeight: bounds.height, scrollHeight: prose.scrollHeight, family: getComputedStyle(prose).fontFamily,
        blocks: [...prose.querySelectorAll('.layout-block')].map(block => {
          const start = Number(block.dataset.layoutStart); let offset = start;
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT); const styles = []; let text;
          while (text = walker.nextNode()) {
            const style = getComputedStyle(text.parentElement); const range = document.createRange(); range.selectNodeContents(text);
            const rects = [...range.getClientRects()];
            styles.push({ start: offset, end: offset + text.textContent.length, text: text.textContent,
              bold: Number(style.fontWeight) >= 600, italic: style.fontStyle === 'italic', size: parseFloat(style.fontSize), family: style.fontFamily,
              bottom: Math.max(0, ...rects.map(rect => rect.bottom - bounds.bottom)) });
            offset += text.textContent.length;
          }
          const style = getComputedStyle(block);
          return { start, end: Number(block.dataset.layoutEnd), text: block.textContent, role: block.className,
            marginBottom: parseFloat(style.marginBottom), lineHeight: parseFloat(style.lineHeight), styles,
            lines: [...block.querySelectorAll('.layout-line')].map(line => ({ text: line.textContent,
              x: line.getBoundingClientRect().left, top: line.getBoundingClientRect().top, height: line.getBoundingClientRect().height })) };
        }) };
    });
  }, scrollPage);
}
function checkRendered(leaves, entries, { emphasis = false, readingSize, fitted = true } = {}) {
  for (const leaf of leaves) {
    const entry = entries.find(entry => entry.number === leaf.page);
    if (!entry) continue;
    for (const block of leaf.blocks) {
      assert.equal(block.text, entry.model.projection.text.slice(block.start, block.end), `page ${leaf.page}: rendered block source changed`);
      for (const style of block.styles) {
        if (fitted && style.text.trim()) assert.ok(style.bottom <= 1.1, `page ${leaf.page}: clipped rendered glyphs (${style.bottom}px)`);
        if (!emphasis || !style.text.trim()) continue;
        assert.equal(style.size, readingSize, 'inline emphasis changed base reading size');
        assert.equal(style.family, leaf.family, 'inline emphasis changed reader font family');
        for (let offset = style.start; offset < style.end; offset++) {
          if (/\s/.test(entry.model.projection.text[offset])) continue;
          const mark = entry.model.projection.emphasis.find(mark => mark.start <= offset && mark.end > offset);
          assert.equal(style.bold, !!mark?.bold, `page ${leaf.page}: bold mismatch at ${offset}`);
          assert.equal(style.italic, !!mark?.italic, `page ${leaf.page}: italic mismatch at ${offset}`);
        }
      }
    }
  }
}
async function walk(page, entries, options = {}) {
  const leaves = []; const spreads = [];
  await jump(page, 1);
  for (let turn = 0; turn < 160; turn++) {
    await settled(page); const spread = await snapshot(page);
    checkRendered(spread, entries, options); spreads.push(spread.map(leaf => [leaf.page, leaf.start, leaf.end])); leaves.push(...spread);
    if (await page.locator('#next-page').isDisabled()) break;
    await page.locator('#next-page').click();
    assert.ok(turn < 159, 'page traversal did not terminate');
  }
  for (const entry of entries) {
    const fragments = leaves.filter(leaf => leaf.page === entry.number && leaf.blocks.length);
    if (!entry.model.projection.text.trim()) continue;
    assert.ok(fragments.length, `source page ${entry.number} unreachable`);
    let end = 0;
    for (const leaf of fragments) {
      assert.equal(leaf.start, end, `source page ${entry.number}: noncontiguous fitted leaves`); end = leaf.end;
    }
    assert.equal(end, entry.model.projection.text.length, `source page ${entry.number}: missing final tail`);
  }
  return { leaves, spreads };
}

async function emphasis(page) {
  const bytes = makeEmphasisPdf(); await importPdf(page, 'Mixed source emphasis.pdf', bytes);
  const canonical = await models(page, [1, 2]); conserved(canonical);
  for (const entry of canonical) {
    assert.ok(entry.model.projection.emphasis?.some(mark => mark.bold && !mark.italic), 'PDF bold missing');
    assert.ok(entry.model.projection.emphasis.some(mark => mark.italic && !mark.bold), 'PDF italic missing');
    assert.ok(entry.model.projection.emphasis.some(mark => mark.bold && mark.italic), 'PDF bold italic missing');
  }
  for (const [viewport, readingSize] of [[{ width: 1440, height: 900 }, 13], [{ width: 390, height: 844 }, 19]]) {
    await page.locator('#pages-layout').click(); await size(page, viewport, readingSize);
    const walked = await walk(page, canonical, { emphasis: true, readingSize });
    assert.ok(walked.leaves.filter(leaf => leaf.page === 1).length > 1, 'emphasis continuation was not exercised');
    await page.locator('#previous-page').click(); await settled(page);
    const before = await savedBook(page); assert.ok(before.bookPosition.offset > 0, 'continuation anchor not exercised');
    await page.reload(); await settled(page);
    assert.deepEqual((await savedBook(page)).bookPosition, before.bookPosition, 'emphasis continuation anchor changed on reload');
    await capture(page, '14', `pages-${viewport.width}-${readingSize}`);
    await page.locator('#scroll-layout').click(); await settled(page);
    for (const number of [1, 2]) {
      await jump(page, number);
      checkRendered(await snapshot(page, number), canonical, { emphasis: true, readingSize, fitted: false });
    }
    await capture(page, '14', `scroll-${viewport.width}-${readingSize}`);
    evidence.push({ issue: 14, viewport, readingSize, spreads: walked.spreads });
  }
  assert.deepEqual(Buffer.from((await savedBook(page)).bytes), bytes, 'source PDF bytes changed');
  report.push('PASS #14: real mixed regular/bold/italic/bold-italic PDF, source conservation and endpoint roundtrips, every rendered character style at 13/19px and desktop/narrow widths, fitted continuations, both layouts and saved/reloaded source anchors.');
}

try {
  await server.listen(); const address = server.httpServer.address();
  assert.ok(typeof address === 'object' && address.port !== 4173, 'must use isolated origin');
  context = await chromium.launchPersistentContext(path.join(runDirectory, 'profile'), {
    channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome', headless: true,
    viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
  });
  for (const issue of selected) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/tests/layout-check.html`);
    await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('demo')));
    await page.goto(`http://127.0.0.1:${address.port}/`); await page.locator('#file-input').waitFor({ state: 'attached' });
    try {
      const check = { 14: emphasis }[issue]; assert.ok(check, `Issue ${issue} harness is being completed`); await check(page);
    } catch (error) { await capture(page, issue, 'failure'); throw error; }
    finally { await page.close(); }
  }
  assert.deepEqual(errors, [], 'renderer errors');
  console.log(report.join('\n')); console.log(`Evidence and isolated profile retained: ${runDirectory}`);
} finally {
  await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify({ issues: selected, report, errors, evidence }, null, 2));
  await context?.close(); await server.close();
}
