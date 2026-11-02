/** Real import and rendered regressions on a fresh retained profile/origin.
 * node tests/fidelity-audit.browser.mjs [14|15|16|17|all]
 */
import assert from 'node:assert/strict';
import { captureReader } from './reader-capture.mjs';
import { waitForAsync } from './browser-wait.mjs';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createServer as tcpServer } from 'node:net';
import { makeEmphasisPdf, makeSpeechPdf, makeOcrPdf, makeTailPdf, makeMeasuredTailPdf, tailLengths } from './fidelity-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = process.argv.includes('--real');
const args = process.argv.slice(2).filter(v => v !== '--real').map(value => value.replace(/^#/, ''));
const selected = !args.length || args.includes('all') ? ['14', '15', '16', '17'] : args;
assert.ok(selected.every(issue => ['14', '15', '16', '17'].includes(issue)), 'Supported issues: 14, 15, 16, 17, all');
const artifacts = path.join(root, 'output', 'playwright', 'reader-fidelity');
await mkdir(artifacts, { recursive: true });
const runDirectory = await mkdtemp(path.join(artifacts, 'run-'));
const reserve = tcpServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const server = await createServer({ root, cacheDir: path.join(runDirectory, 'vite-cache'),
  // Fixed test inputs do not need a watcher over retained reports/profiles.
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }, clearScreen: false });
let context;
const report = []; const errors = []; const evidence = []; const failures = []; const requests = [];
let incomplete = false;
const baseline17 = process.env.FOLIO_FIDELITY_BASELINE === '1';
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
  // A fresh Vite origin took 28.5s just to serve PDF.js and its worker. Keep
  // import setup bounded like the compatibility runner, outside timing gates.
  await page.waitForFunction(() => !document.querySelector('#modal').open
    && document.querySelector('#book-type')?.textContent === 'FROM YOUR SHELF', null, { timeout:90_000 });
  await waitForAsync(page, async filename => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return book?.filename === filename && book.structure?.status === 'complete';
  }, name, { timeout: 60_000, label:`completed scan for ${name}` });
  await settled(page);
}
async function capture(page, issue, label) {
  if (label.includes('failure') || await page.locator('#modal').evaluate(n => n.open)) await page.screenshot({ path:path.join(runDirectory, `issue-${issue}-${label}.png`), fullPage:false });
  else await captureReader(page, path.join(runDirectory, `issue-${issue}-${label}.png`));
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
  if (await page.locator('body').evaluate(body => body.classList.contains('scroll-mode'))) {
    await page.locator(`.scroll-page[data-source-page="${number}"] .layout-block, .scroll-page[data-source-page="${number}"] canvas`).first().waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#scroll-stage').dataset.activeLoads === '0');
  }
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
  // Read readiness and the ranges in one browser task. A later scan/resize
  // render must not turn an empty paper shell into an accepted source fragment.
  return waitForAsync(page, number => {
    const scroll = document.body.classList.contains('scroll-mode');
    const stage = document.querySelector(scroll ? '#scroll-stage' : '#book-spread');
    if (stage.getAttribute('aria-busy') === 'true' || scroll && stage.dataset.activeLoads !== '0') return false;
    const selector = scroll ? `.scroll-page[data-source-page="${number}"]` : '#book-spread > .paper-page:not(.end-page)';
    const leaves = [...document.querySelectorAll(selector)];
    if (!leaves.length || leaves.some(leaf => !leaf.querySelector('.layout-block, canvas'))) return false;
    return leaves.map(leaf => {
      const prose = leaf.querySelector('.page-prose');
      if (!prose) return { page: Number(leaf.dataset.sourcePage), start: 0, end: 0, blocks: [] };
      const bounds = prose.getBoundingClientRect();
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
          return { id: block.dataset.blockId, start, end: Number(block.dataset.layoutEnd), text: block.textContent, role: block.className,
            speech: block.dataset.speech, label: block.getAttribute('aria-label'), speaker: block.querySelector('.layout-speaker')?.textContent,
            marginBottom: parseFloat(style.marginBottom), lineHeight: parseFloat(style.lineHeight), styles,
            lines: [...block.querySelectorAll('.layout-line')].map(line => ({ text: line.textContent,
              start: Number(line.dataset.layoutStart), indent: line.style.getPropertyValue('--line-indent'),
              x: line.getBoundingClientRect().left, top: line.getBoundingClientRect().top, height: line.getBoundingClientRect().height })) };
        }) };
    });
  }, scrollPage, { label:'atomic rendered source snapshot' });
}
function checkRendered(leaves, entries, { emphasis = false, readingSize, fitted = true } = {}) {
  for (const leaf of leaves) {
    const entry = entries.find(entry => entry.number === leaf.page);
    if (!entry) continue;
    for (const block of leaf.blocks) {
      // A leaf can end in the separator after a preserved line; that separator
      // has no text node until the next source line is mounted on another leaf.
      assert.equal(block.text.trimEnd(), entry.model.projection.text.slice(block.start, block.end).trimEnd(), `page ${leaf.page}: rendered block source changed`);
      for (const style of block.styles) {
        if (fitted && style.text.trim()) assert.ok(style.bottom <= 1.1, `page ${leaf.page}: clipped rendered glyphs (${style.bottom}px)`);
        if (!emphasis || !style.text.trim()) continue;
        assert.equal(style.size, readingSize, 'inline emphasis changed base reading size');
        assert.equal(style.family, leaf.family, 'inline emphasis changed reader font family');
        for (let offset = style.start; offset < style.end; offset++) {
          if (/\s/.test(entry.model.projection.text[offset])) continue;
          const mark = (entry.model.projection.emphasis ?? []).find(mark => mark.start <= offset && mark.end > offset);
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

async function walkSource(page, entry) {
  await jump(page, entry.number); const leaves = [];
  for (let turn = 0; turn < 60; turn++) {
    const spread = await snapshot(page);
    checkRendered(spread, [entry]);
    leaves.push(...spread.filter(leaf => leaf.page === entry.number));
    if (leaves.at(-1)?.end === entry.model.projection.text.length) break;
    assert.ok(!await page.locator('#next-page').isDisabled(), 'source text became unreachable');
    await page.locator('#next-page').click(); await settled(page);
    assert.ok(turn < 59, 'source page traversal did not terminate');
  }
  let end = 0;
  for (const leaf of leaves) {
    assert.equal(leaf.start, end, 'speech fragments are not contiguous'); end = leaf.end;
  }
  assert.equal(end, entry.model.projection.text.length, 'speech final source text lost');
  return leaves;
}
function speechDensity(leaves, entry) {
  const blocks = leaves.flatMap(leaf => leaf.blocks); let compactBoundaries = 0; let measuredBoundaries = 0; let retainedBoundaries = 0;
  for (const leaf of leaves) for (let index = 0; index < leaf.blocks.length - 1; index++) {
    const block = leaf.blocks[index]; const next = leaf.blocks[index + 1];
    const source = entry.model.blocks.find(candidate => candidate.id === block.id);
    const sourceIndex = entry.model.blocks.indexOf(source); const nextSource = entry.model.blocks[sourceIndex + 1];
    if (block.end !== source.end || next.start !== nextSource?.start || !block.lines.length || !next.lines.length) continue;
    const last = block.lines.at(-1); const gap = next.lines[0].top - last.top - last.height;
    if (source.continuesToNext) {
      assert.ok(Math.abs(gap) <= 1.1, `source ${entry.number}: adjacent speech lines gained ${gap}px of paragraph gap`);
      measuredBoundaries++;
    } else if (['speech', 'line-group', 'stage-direction'].includes(source.role)) {
      assert.ok(block.marginBottom > 0 && gap > 0, 'source stanza, stage or speaker boundary lost visible separation');
      retainedBoundaries++;
    }
  }
  for (const block of blocks) {
    const source = entry.model.blocks.find(candidate => candidate.id === block.id);
    if (source.continuesToNext) {
      assert.equal(block.marginBottom, 0, `source ${entry.number} ${block.id}: invented paragraph gap between ordinary speech lines`);
      compactBoundaries++;
    }
    if (source.speaker && block.start === source.start) {
      assert.equal(block.speaker, source.speaker, 'speaker label changed');
      assert.equal(block.speech, source.association, 'speaker association changed');
    }
    for (let index = 1; index < block.lines.length; index++) {
      const previous = block.lines[index - 1]; const line = block.lines[index];
      assert.ok(line.top - previous.top - previous.height < 1.1, 'paragraph gap inserted inside preserved source lines');
    }
    const region = entry.model.regions.find(region => region.id === source.regionId);
    for (const line of block.lines) {
      const original = source.lines.find(original => line.start >= original.start && line.start < original.end);
      assert.ok(original, 'preserved line source identity missing');
      const indent = Math.max(0, Math.min(6, (original.x - (region?.x ?? original.x)) / entry.model.bodySize));
      assert.equal(parseFloat(line.indent), indent, 'source line indentation changed');
    }
  }
  assert.ok(compactBoundaries > 0, `source ${entry.number}: no compact speech boundaries exercised`);
  assert.ok(measuredBoundaries > 0, `source ${entry.number}: actual compact line geometry was not exercised`);
  assert.ok(retainedBoundaries > 0, `source ${entry.number}: genuine speech/stanza boundary was not exercised`);
  return { blocks: blocks.length, compactBoundaries, measuredBoundaries, retainedBoundaries,
    speakers: blocks.filter(block => block.speaker).map(block => block.speaker),
    preservedLines: blocks.reduce((count, block) => count + block.lines.length, 0) };
}
async function speech(page) {
  for (const [name, bytes, numbers, label] of [
    ['Original speech and stanza.pdf', makeSpeechPdf(), [1], 'original-speech'],
    ['Hamlet.pdf', await readFile(path.join(root, 'testing_downloads', 'Hamlet.pdf')), [10, 20, 50], 'hamlet'],
  ]) {
    await page.locator('#pages-layout').click(); await page.locator('#book-view').click();
    await importPdf(page, name, bytes); const canonical = await models(page, numbers); conserved(canonical);
    await writeFile(path.join(runDirectory, `issue-15-${label}-models.json`), JSON.stringify(canonical, null, 2));
    for (const [viewport, readingSize] of [[{ width: 1440, height: 900 }, 13], [{ width: 390, height: 844 }, 19]]) {
      await page.locator('#pages-layout').click(); await size(page, viewport, readingSize);
      for (const entry of canonical) {
        const leaves = await walkSource(page, entry);
        const density = speechDensity(leaves, entry);
        evidence.push({ issue: 15, label, viewport, readingSize, sourcePage: entry.number, density,
          fragments: leaves.map(leaf => [leaf.start, leaf.end]) });
        await jump(page, entry.number); await capture(page, '15', `${label}-${entry.number}-pages-${viewport.width}-${readingSize}`);
        if (viewport.width === 1440) {
          await page.locator('#original-view').click();
          await page.locator('#original-stage canvas').waitFor({ state: 'visible' });
          await capture(page, '15', `${label}-${entry.number}-original`);
          await page.locator('#book-view').click(); await settled(page);
        }
      }
      await page.locator('#scroll-layout').click(); await settled(page);
      for (const entry of canonical) {
        await jump(page, entry.number); const leaves = await snapshot(page, entry.number);
        checkRendered(leaves, canonical, { fitted: false }); speechDensity(leaves, entry);
        if (label === 'original-speech') for (const [word, bold, italic] of [['quiet', true, false], ['songs', false, true]]) {
          const runs = leaves.flatMap(leaf => leaf.blocks).flatMap(block => block.styles).filter(style => style.text.trim() === word);
          assert.equal(runs.length, 1, `speech inline ${word} missing or duplicated`);
          assert.equal(runs[0].bold, bold); assert.equal(runs[0].italic, italic);
          assert.equal(runs[0].size, readingSize, 'speech inline emphasis changed reader text size');
          assert.equal(runs[0].family, leaves[0].family, 'speech inline emphasis changed reader family');
        }
        assert.equal(compact(leaves.flatMap(leaf => leaf.blocks).map(block => block.text).join(' ')), compact(entry.model.projection.text), 'Scroll speech source order changed');
        await capture(page, '15', `${label}-${entry.number}-scroll-${viewport.width}-${readingSize}`);
      }
    }
    assert.deepEqual(Buffer.from((await savedBook(page)).bytes), Buffer.from(bytes), `${label}: PDF bytes changed`);
  }
  report.push('PASS #15: original speech/stanza with inline emphasis and real Hamlet pages10/20/50, Original PDF comparison captures, compact source-adjacent speech density, labels/associations, source order, measured fitting, both layouts and desktop/narrow 13/19px, source endpoint roundtrips and unchanged PDF bytes.');
}

async function ocr(page) {
  const bytes = makeOcrPdf(); const cleanBytes = makeOcrPdf({ ocrMismatch: false });
  await page.locator('#pages-layout').click(); await page.locator('#book-view').click();
  await importPdf(page, 'Visible God extracted Cod.pdf', bytes);
  await writeFile(path.join(runDirectory, 'Visible God clean text reference.pdf'), cleanBytes);
  const raster = await page.evaluate(async buffers => {
    const { openPdf, renderPdfPage } = await import('/src/pdf-engine.js'); const rendered = [];
    for (const bytes of buffers) {
      const pdf = await openPdf(new Uint8Array(bytes)); const canvas = document.createElement('canvas');
      try {
        const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str ?? '').join(' ');
        await renderPdfPage(pdf, 1, canvas, { scale: 1 });
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        rendered.push({ text, hash, png: canvas.toDataURL('image/png'),
          ink: pixels.reduce((sum, channel, index) => sum + (index % 4 < 3 && channel < 128 ? 1 : 0), 0) });
      } finally { await pdf.loadingTask.destroy(); }
    }
    return rendered;
  }, [Array.from(bytes), Array.from(cleanBytes)]);
  assert.match(raster[0].text, /Cod keeps/); assert.doesNotMatch(raster[0].text, /God keeps/);
  assert.match(raster[1].text, /God keeps/); assert.doesNotMatch(raster[1].text, /Cod keeps/);
  assert.ok(raster[0].ink > 1000, 'OCR fixture raster was blank');
  assert.equal(raster[0].hash, raster[1].hash, 'ToUnicode mismatch altered the visible God glyphs');
  for (const [index, item] of raster.entries()) await writeFile(path.join(runDirectory, `issue-16-${index ? 'clean' : 'mismatched'}-raster.png`), Buffer.from(item.png.split(',')[1], 'base64'));
  evidence.push({ issue: 16, raster: raster.map(({ png, ...item }) => item) });
  const canonical = await models(page, [1]); conserved(canonical);
  for (const [viewport, readingSize] of [[{ width: 1440, height: 900 }, 13], [{ width: 390, height: 844 }, 19], [{ width: 320, height: 740 }, 23]]) {
    await page.locator('#pages-layout').click(); await size(page, viewport, readingSize);
    await jump(page, 1); await page.locator('#next-page').click(); await settled(page);
    assert.ok((await savedBook(page)).bookPosition.offset > 0, 'OCR recovery did not exercise a continuation anchor');
    for (const mode of ['pages', 'scroll']) {
      await page.locator(`#${mode}-layout`).click(); await settled(page); await pause(850);
      const before = await savedBook(page);
      const visible = (await snapshot(page, 1)).flatMap(leaf => leaf.blocks).map(block => block.text).join(' ');
      assert.match(visible, /Cod keeps/); assert.doesNotMatch(visible, /God keeps/, 'Book view guessed a correction');
      await page.locator('#text-help-button').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'OCR recovery UI overflows the viewport horizontally');
      const help = await page.locator('#modal').textContent();
      assert.match(help, /OCR or encoding mistakes/); assert.match(help, /does not guess replacement words or run OCR/);
      await capture(page, '16', `${mode}-${viewport.width}-${readingSize}-help`);
      await page.locator('#use-original-button').click();
      await page.locator('canvas:visible').first().waitFor();
      assert.equal(await page.locator('#original-view').getAttribute('aria-pressed'), 'true');
      assert.deepEqual((await savedBook(page)).bookPosition, before.bookPosition, 'OCR help moved Book source anchor');
      await capture(page, '16', `${mode}-${viewport.width}-${readingSize}-original`);
      await page.reload(); await page.locator('canvas:visible').first().waitFor();
      assert.equal(await page.locator('#original-view').getAttribute('aria-pressed'), 'true', 'Original view did not restore');
      assert.deepEqual((await savedBook(page)).bookPosition, before.bookPosition, 'Original reload moved Book source anchor');
      await page.locator('#book-view').click(); await settled(page); await pause(850);
      const after = await savedBook(page);
      assert.deepEqual(after.bookPosition.source, before.bookPosition.source, 'return from Original moved source identity');
      assert.equal(after.bookPosition.offset, before.bookPosition.offset, 'return from Original moved source offset');
      assert.deepEqual(Buffer.from(after.bytes), bytes, 'OCR recovery changed original PDF bytes');
      checkRendered(await snapshot(page, 1), canonical, { fitted: mode === 'pages' });
      await capture(page, '16', `${mode}-${viewport.width}-${readingSize}-book-restored`);
      evidence.push({ issue: 16, viewport, readingSize, mode, before: before.bookPosition, after: after.bookPosition });
    }
  }
  report.push('PASS #16: real ToUnicode mismatch extracts Cod while raster-identical clean reference visibly contains God; Book keeps source text, help explains OCR/encoding limitations, Original and Book recovery in both layouts at desktop/narrow 13/19/23px including320px, view reloads and exact source anchors/offsets/PDF bytes retained.');
}

async function measure(page, entry) {
  await page.locator('#pages-layout').click(); await jump(page, entry.number);
  return page.evaluate(async ({ model, number }) => {
    const { paginateText } = await import('/src/book-pagination.js');
    const { paginateLayout, renderLayout } = await import('/src/layout-reading.js');
    const source = document.querySelector(`#book-spread > .paper-page[data-source-page="${number}"]`);
    const bounds = source.getBoundingClientRect(); const host = document.createElement('div');
    host.className = 'book-measure'; host.style.width = `${bounds.width}px`; host.style.height = `${bounds.height}px`;
    const first = source.cloneNode(true); const continuation = source.cloneNode(true);
    continuation.querySelector('.chapter-intro')?.remove(); host.append(first, continuation); document.body.append(host);
    try {
      const fits = (text, { start, end }) => {
        const leaf = start === 0 ? first : continuation; const prose = leaf.querySelector('.page-prose');
        const intro = prose.querySelector('.chapter-intro'); prose.replaceChildren(...intro ? [intro] : []);
        renderLayout(prose, model, { start, end, decorate: !!intro });
        const last = prose.lastElementChild;
        return prose.scrollHeight <= prose.clientHeight
          && (!last || last.getBoundingClientRect().bottom <= prose.getBoundingClientRect().bottom - 1);
      };
      const greedy = paginateText(model.projection.text, fits); const balanced = paginateLayout(model, fits);
      const describe = fragments => ({ lengths: fragments.map(fragment => fragment.end - fragment.start),
        fragments: fragments.map(({ start, end }) => ({ start, end })),
        measuredFits: fragments.map(fragment => fits(fragment.text, fragment)),
        text: fragments.map(fragment => fragment.text).join(''),
        ratio: fragments.length > 1 ? (fragments.at(-1).end - fragments.at(-1).start)
          / (fragments.at(-1).end - fragments.at(-2).start) : 1 });
      return { number, greedy: describe(greedy), balanced: describe(balanced) };
    } finally { host.remove(); }
  }, entry);
}
function balanced(result, text) {
  for (const mode of ['greedy', 'balanced']) {
    assert.equal(result[mode].text, text, `${mode}: final pair changed source text`);
    assert.ok(result[mode].measuredFits.every(Boolean), `${mode}: a measured leaf did not fit`);
    let end = 0;
    for (const fragment of result[mode].fragments) { assert.equal(fragment.start, end); end = fragment.end; }
    assert.equal(end, text.length);
  }
  assert.equal(result.balanced.fragments.length, result.greedy.fragments.length, 'balance changed leaf count');
  if (!baseline17 && result.greedy.ratio < .25) {
    assert.ok(result.balanced.ratio > result.greedy.ratio, 'sparse terminal leaf was not improved');
    assert.ok(result.balanced.ratio >= .25, 'terminal pair remains visibly sparse');
  }
}
async function symmetry(page, walked) {
  let reloaded = false;
  for (let index = walked.spreads.length - 2; index >= 0; index--) {
    await page.locator('#previous-page').click(); await settled(page);
    const actual = (await snapshot(page)).map(leaf => [leaf.page, leaf.start, leaf.end]);
    assert.deepEqual(actual, walked.spreads[index], 'backward navigation changed fitted leaf boundaries');
    const before = await savedBook(page);
    if (!reloaded && before.bookPosition?.offset > 0 && before.bookPosition.source) {
      await page.reload(); await settled(page);
      assert.deepEqual((await savedBook(page)).bookPosition, before.bookPosition, 'balanced continuation anchor changed on reload');
      assert.deepEqual((await snapshot(page)).map(leaf => [leaf.page, leaf.start, leaf.end]), actual, 'balanced spread changed on reload');
      reloaded = true;
    }
  }
  assert.ok(reloaded, 'balanced source anchor reload was not exercised');
}
async function anchorRewrap(page) {
  await page.locator('#next-page').click(); await settled(page);
  const before = await savedBook(page); assert.ok(before.bookPosition.offset > 0, 'rewrap anchor did not exercise continuation');
  await page.locator('#bookmark-button').click();
  await size(page, { width: 820, height: 900 }, 17);
  const resized = await savedBook(page);
  assert.deepEqual(resized.bookPosition.source, before.bookPosition.source, 'resize/font adjustment moved source anchor');
  assert.equal(resized.bookPosition.offset, before.bookPosition.offset, 'resize/font adjustment moved canonical offset');
  assert.ok(resized.bookmarks.includes(before.page), 'bookmark lost after rewrap');
  await page.reload(); await settled(page);
  const after = await savedBook(page);
  assert.deepEqual(after.bookPosition.source, before.bookPosition.source, 'rewrapped anchor did not restore');
  assert.equal(after.bookPosition.offset, before.bookPosition.offset, 'rewrapped offset did not restore');
  assert.ok(after.bookmarks.includes(before.page), 'bookmark did not restore');
  await jump(page, 6);
  assert.equal((await savedBook(page)).page, 6, 'source-page jump missed target after rewrap');
}
async function tails(page) {
  const label = baseline17 ? 'baseline' : 'balanced';
  await page.locator('#pages-layout').click(); await page.locator('#book-view').click();
  await importPdf(page, 'Tail calibration.pdf', makeMeasuredTailPdf());
  await size(page, { width: 1440, height: 900 }, 13);
  const calibration = await models(page, [1, 2, 3]); const lengths = [];
  for (const [index, entry] of calibration.entries()) {
    const result = await measure(page, entry); lengths.push(result.greedy.fragments[0].end + tailLengths[index]);
  }
  const bytes = makeMeasuredTailPdf(lengths); await importPdf(page, 'Measured short terminal tails.pdf', bytes);
  const canonical = await models(page, [1, 2, 3]); conserved(canonical);
  for (const [index, entry] of canonical.entries()) {
    const result = await measure(page, entry);
    evidence.push({ issue: 17, label, fixture: 'exact-terminal-tail', target: tailLengths[index], ...result });
    assert.equal(result.greedy.lengths.at(-1), tailLengths[index], 'fixture did not reproduce exact greedy terminal length');
    const leaves = await walkSource(page, entry);
    checkRendered(leaves, canonical, { emphasis: true, readingSize: 13 });
    assert.deepEqual(leaves.map(({ start, end }) => ({ start, end })), result.balanced.fragments, 'measured helper differs from actual production leaves');
    evidence.at(-1).actual = leaves.map(({ start, end }) => ({ start, end }));
    console.log(`#17 ${label} tail${tailLengths[index]}: greedy=${result.greedy.lengths.join('/')} production=${result.balanced.lengths.join('/')}`);
    await capture(page, '17', `${label}-tail-${tailLengths[index]}-1440-13`);
    balanced(result, entry.model.projection.text);
  }
  await importPdf(page, 'Original tails blank and image pages.pdf', makeTailPdf());
  const mixed = await models(page, [1, 2, 3, 4, 5, 6, 7]); conserved(mixed);
  for (const [viewport, readingSize] of [[{ width: 1440, height: 900 }, 13], [{ width: 390, height: 844 }, 19]]) {
    await page.locator('#pages-layout').click(); await size(page, viewport, readingSize);
    const walked = await walk(page, mixed);
    for (const number of [4, 5, 7]) assert.ok(walked.leaves.some(leaf => leaf.page === number), `blank/image/verse source ${number} was skipped`);
    await symmetry(page, walked); evidence.push({ issue: 17, label, fixture: 'mixed-pages', viewport, readingSize, spreads: walked.spreads });
    await capture(page, '17', `${label}-mixed-pages-${viewport.width}-${readingSize}`);
    if (viewport.width === 1440) {
      await anchorRewrap(page); await size(page, viewport, readingSize); await jump(page, 1);
    }
    await page.locator('#scroll-layout').click(); await settled(page);
    for (const number of [1, 3, 7]) {
      await jump(page, number); const leaves = await snapshot(page, number);
      checkRendered(leaves, mixed, { fitted: false });
      assert.equal(compact(leaves.flatMap(leaf => leaf.blocks).map(block => block.text).join(' ')), compact(mixed[number - 1].model.projection.text));
    }
    await capture(page, '17', `${label}-mixed-scroll-${viewport.width}-${readingSize}`);
  }
  if (real) {
  const nietzschePath = process.env.FOLIO_NIETZSCHE_PDF;
  assert.ok(nietzschePath, 'Required real corpus unavailable: set FOLIO_NIETZSCHE_PDF');
  await page.locator('#pages-layout').click(); await size(page, { width: 1440, height: 900 }, 13);
  const nietzsche = await readFile(nietzschePath); await importPdf(page, 'Nietzsche source regression.pdf', nietzsche);
  const [entry] = await models(page, [3]); conserved([entry]); const result = await measure(page, entry);
  evidence.push({ issue: 17, label, fixture: 'real-nietzsche-page3', ...result });
  const leaves = await walkSource(page, entry);
  assert.deepEqual(leaves.map(({ start, end }) => ({ start, end })), result.balanced.fragments, 'Nietzsche helper differs from actual production leaves');
  evidence.at(-1).actual = leaves.map(({ start, end }) => ({ start, end }));
  console.log(`#17 ${label} Nietzsche3: greedy=${result.greedy.lengths.join('/')} production=${result.balanced.lengths.join('/')}`);
  await capture(page, '17', `${label}-nietzsche-page3-1440-13`); balanced(result, entry.model.projection.text);
  const digest = await page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', book.bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
  assert.equal(digest, createHash('sha256').update(nietzsche).digest('hex'), 'Nietzsche source PDF bytes changed');
  }
  report.push(baseline17
    ? 'BASELINE #17 diagnostic only: exact48/65/74 greedy terminal tails, optional real Nietzsche page3 after14-16, measured fits and source coverage captured; improvement acceptance was intentionally not evaluated.'
    : 'PASS #17: exact48/65/74 greedy terminal tails (including bold italic) and optional real Nietzsche page3 at1440x90013px improve below25% final-pair share, both final leaves measured to fit, actual production/helper boundaries match, contiguous source coverage, blank/image/verse pages, forward/back symmetry, bookmark/resize/font/reload/source-jump anchors, desktop/narrow13/19px Pages/Scroll, original PDF bytes preserved.');
}

try {
  if (real) {
    try { assert.ok(process.env.FOLIO_NIETZSCHE_PDF); await access(process.env.FOLIO_NIETZSCHE_PDF); }
    catch { incomplete = true; throw new Error('Required real corpus unavailable: set FOLIO_NIETZSCHE_PDF'); }
  }
  await server.listen(); const address = server.httpServer.address();
  assert.ok(typeof address === 'object' && address.port !== 4173, 'must use isolated origin');
  context = await chromium.launchPersistentContext(path.join(runDirectory, 'profile'), {
    channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome', headless: true,
    viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
  });
  for (const issue of selected) {
    const page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
    page.on('request', request => requests.push({ event:'request', url:request.url(), time:Date.now() }));
    page.on('requestfinished', request => requests.push({ event:'finished', url:request.url(), time:Date.now() }));
    page.on('requestfailed', request => requests.push({ event:'failed', url:request.url(), failure:request.failure(), time:Date.now() }));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/tests/fidelity-check.html`, { waitUntil: 'domcontentloaded' });
    if (issue === selected[0]) {
      await page.evaluate(() => { window.asyncWaitChecks = 0; });
      assert.equal(await waitForAsync(page, async () => ++window.asyncWaitChecks >= 3), true);
      assert.equal(await page.evaluate(() => window.asyncWaitChecks), 3, 'async false must be retried');
      await assert.rejects(() => waitForAsync(page, async () => false, undefined, { timeout:150 }), /timed out/i);
      const empty = await waitForAsync(page, async () => {
        const { openPdf } = await import('/src/pdf-engine.js');
        const { makeLayoutPdf } = await import('/tests/pdf-layout-fixture.mjs');
        const bytes = makeLayoutPdf([]);
        const original = Array.from(bytes);
        try {
          const pdf = await openPdf(bytes.buffer);
          await pdf.loadingTask.destroy();
          return { rejected:false };
        } catch (error) { return { rejected:true, message:error.message,
          bytesUnchanged:bytes.byteLength === original.length && original.every((value, index) => bytes[index] === value) }; }
      }, undefined, { timeout:90_000 });
      assert.equal(empty.rejected, true, 'no-signal open must reject a zero-page document');
      assert.match(empty.message, /contains no pages/);
      assert.equal(empty.bytesUnchanged, true);
    }
    await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('demo')));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#appearance-button')?.hasAttribute('aria-valuenow')
      && (document.body.classList.contains('scroll-mode')
        ? document.querySelector('#scroll-stage')?.dataset.activeLoads === '0'
          && Boolean(document.querySelector('#scroll-stage .page-prose p'))
        : document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'));
    try {
      const check = { 14: emphasis, 15: speech, 16: ocr, 17: tails }[issue]; await check(page);
    } catch (error) {
      failures.push({ issue, message: error.message, stack: error.stack });
      await capture(page, issue, 'failure'); throw error;
    }
    finally { await page.close(); }
  }
  assert.deepEqual(errors, [], 'renderer errors');
  console.log(report.join('\n')); console.log(`Evidence and isolated profile retained: ${runDirectory}`);
} catch (error) {
  if (!failures.length) failures.push({ issue: 'setup-or-renderer', message: error.message, stack: error.stack });
  throw error;
} finally {
  await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify({ issues: selected, baseline17, matrix:real ? 'core-and-real' : 'portable-core',
    status: incomplete ? 'incomplete' : failures.length || errors.length || report.length !== selected.length
      ? 'failed' : baseline17 && selected.includes('17') ? 'baseline-diagnostic' : 'passed',
    report, errors, failures, evidence, requests }, null, 2));
  await context?.close(); await server.close();
}
