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
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false }, clearScreen: false });
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
  return page.evaluate(number => {
    const selector = document.body.classList.contains('scroll-mode')
      ? `.scroll-page[data-source-page="${number}"]` : '#book-spread > .paper-page';
    return [...document.querySelectorAll(selector)].map(leaf => {
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
  }, scrollPage);
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

async function walkSource(page, entry) {
  await jump(page, entry.number); const leaves = [];
  for (let turn = 0; turn < 60; turn++) {
    const spread = await snapshot(page); checkRendered(spread, [entry]);
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
  report.push('PASS #16: real ToUnicode mismatch extracts Cod while raster-identical clean reference visibly contains God; Book keeps source text, help explains OCR/encoding limitations, Original and Book recovery in both layouts at desktop/narrow 13/19px, view reloads and exact source anchors/offsets/PDF bytes retained.');
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
      const check = { 14: emphasis, 15: speech, 16: ocr }[issue]; assert.ok(check, `Issue ${issue} harness is being completed`); await check(page);
    } catch (error) { await capture(page, issue, 'failure'); throw error; }
    finally { await page.close(); }
  }
  assert.deepEqual(errors, [], 'renderer errors');
  console.log(report.join('\n')); console.log(`Evidence and isolated profile retained: ${runDirectory}`);
} finally {
  await writeFile(path.join(runDirectory, 'report.json'), JSON.stringify({ issues: selected, report, errors, evidence }, null, 2));
  await context?.close(); await server.close();
}
