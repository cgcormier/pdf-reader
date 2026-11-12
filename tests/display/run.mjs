import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as tcpServer } from 'node:net';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { makeLayoutPdf } from '../pdf-layout-fixture.mjs';
import { settledReader } from '../reader-capture.mjs';
import { waitForAsync } from '../browser-wait.mjs';
import { cases } from './fixtures.mjs';
import { compare, compareContents } from './oracle.mjs';

const checkerOnly = process.argv.slice(2).length === 1 && process.argv[2] === '--checker-selftest';
if (process.argv.length > 2 && !checkerOnly) {
  console.error('This portable suite accepts no arguments; edition-specific PDF testing is not implemented.');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'output/playwright/display-suite');
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, 'run-'));
const reserve = tcpServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const server = await createServer({ root, cacheDir: path.join(run, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null, fs: { allow: [root, await realpath(path.join(root, 'node_modules'))] } }, clearScreen: false });
const report = { run, status: 'running', planned: checkerOnly ? 0 : cases.reduce((sum, fixture) => sum + fixture.checked.length * 4, 0), executed: 0, checkerValidation: [], cases: [], harnessErrors: [] };
let context;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
async function saveReport() {
  report.executed = report.cases.length;
  await writeFile(path.join(run, 'report.json'), JSON.stringify(report, null, 2));
  const rows = report.cases.map(c => `<section><h2>${escape(c.name)} — ${escape(c.mode)} ${escape(c.viewport)} page ${c.page}</h2><p>${escape(c.failures.length ? c.failures.join('; ') : 'PASS')}</p><h3>Expected</h3><pre>${escape(JSON.stringify(c.expected, null, 2))}</pre><h3>Observed</h3><pre>${escape(JSON.stringify(c.actual, null, 2))}</pre>${c.screenshots.map(s => `<a href="${escape(s)}"><img width="320" src="${escape(s)}" alt="Reader screenshot"></a>`).join(' ')}</section>`).join('\n');
  await writeFile(path.join(run, 'report.html'), `<!doctype html><meta charset="utf-8"><title>Display suite</title><style>body{font:16px system-ui;max-width:1000px;margin:auto}section{border-top:1px solid #aaa;padding:1em}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:1em}</style><h1>Display suite</h1><p>Status: ${escape(report.status)}; executed ${report.executed} of ${report.planned} planned cases.</p><p>Expected text is a semantic reading reference, not a pixel-perfect PDF rendering.</p><p>Checker validation: ${escape(JSON.stringify(report.checkerValidation))}</p><p>Harness errors: ${escape(JSON.stringify(report.harnessErrors))}</p>${rows}`);
}
async function importCase(page, fixture) {
  await page.locator('#file-input').setInputFiles({ name: `${fixture.name}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(makeLayoutPdf(fixture.pages)) });
  await page.waitForFunction(() => !document.querySelector('#modal').open && document.querySelector('#book-type')?.textContent === 'FROM YOUR SHELF');
  await waitForAsync(page, async name => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return book?.filename === name && book.structure.status === 'complete';
  }, `${fixture.name}.pdf`, { timeout: 30000, label: 'import and structure scan' });
}
async function nodes(page) {
  return page.evaluate(async () => {
    const { getBook } = await import('/src/storage.js');
    const book = await getBook(JSON.parse(localStorage.getItem('folio:active-book')));
    return { stored: book.structure.nodes.map(({ title, page, y }) => ({ title, page, y })), displayed: [...document.querySelectorAll('[data-node-id] .chapter-label')].map(n => n.textContent.trim()) };
  });
}
async function inspect(page, fixture, number, mode, viewport, contents, mutation = null) {
  await page.locator('#page-input').fill(String(number)); await page.locator('#page-input').press('Enter');
  await settledReader(page, number);
  if (mutation) await page.evaluate(kind => {
    const prose = document.querySelector('#book-spread > .paper-page .page-prose');
    if (kind === 'hidden') prose.querySelector('.layout-block').style.visibility = 'hidden';
    else { prose.style.maxHeight = '5px'; prose.style.overflow = 'hidden'; }
  }, mutation);
  const pieces = new Map(), screenshots = [], collectionFailures = [];
  let previousAnchor;
  for (let turn = 0; turn < 100; turn++) {
    await settledReader(page);
    if (mode === 'pages') {
      const anchor = await page.locator('#book-spread > .paper-page').first().evaluate(leaf => `${leaf.dataset.sourcePage}:${leaf.dataset.textOffset || 0}`);
      if (anchor === previousAnchor) { collectionFailures.push(`page turn did not advance from ${anchor}`); break; }
      previousAnchor = anchor;
    }
    const leaves = await page.evaluate(({ number, mode }) => {
      const selector = mode === 'pages' ? '#book-spread > .paper-page' : '.scroll-page';
      return [...document.querySelectorAll(selector)].filter(leaf => Number(leaf.dataset.sourcePage) === number).map(leaf => {
        const prose = leaf.querySelector('.page-prose'); const box = prose.getBoundingClientRect();
        const blocks = [...prose.querySelectorAll('.layout-block')].map(block => {
          const style = getComputedStyle(block), r = block.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(block);
          const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
          let ancestorsVisible = true;
          for (let node = block; node; node = node.parentElement) {
            const css = getComputedStyle(node), bounds = node.getBoundingClientRect();
            if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) === 0) ancestorsVisible = false;
            if (mode === 'pages' && rects.some(rect => (['hidden', 'clip'].includes(css.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) || (['hidden', 'clip'].includes(css.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)))) ancestorsVisible = false;
          }
          if (mode === 'pages' && rects.some(rect => rect.top < -1 || rect.bottom > innerHeight + 1 || rect.left < -1 || rect.right > innerWidth + 1)) ancestorsVisible = false;
          const transparent = style.color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(style.color);
          const ok = ancestorsVisible && !transparent && rects.length > 0 && rects.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1 && (mode === 'scroll' || rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1));
          const ratio = parseFloat(style.fontSize) / parseFloat(getComputedStyle(prose).fontSize);
          return { text: block.textContent, role: block.tagName.toLowerCase(), start: Number(block.dataset.layoutStart), end: Number(block.dataset.layoutEnd), ok, ratio };
        });
        const intros = [...prose.querySelectorAll('.chapter-intro')].map(node => node.innerText);
        return { offset: Number(leaf.dataset.textOffset || 0), blocks, intros };
      });
    }, { number, mode });
    if (new Set(leaves.map(leaf => leaf.offset)).size !== leaves.length) collectionFailures.push('duplicate leaves at the same source offset');
    for (const leaf of leaves) {
      if (pieces.has(leaf.offset) && JSON.stringify(pieces.get(leaf.offset)) !== JSON.stringify(leaf)) collectionFailures.push('same source offset rendered inconsistently');
      else if (!pieces.has(leaf.offset)) pieces.set(leaf.offset, leaf);
    }
    const screenshot = `${fixture.name}-${viewport}-${mode}-p${number}-${mutation || 'normal'}-${turn}.png`;
    await page.screenshot({ path: path.join(run, screenshot) }); screenshots.push(screenshot);
    if (mode === 'scroll') {
      const visibility = await page.evaluate(number => {
        const stage = document.querySelector('#scroll-stage');
        const leaf = stage.querySelector(`.scroll-page[data-source-page="${number}"]`);
        const before = stage.scrollTop; const failures = []; let lines = 0;
        for (const block of leaf.querySelectorAll('.layout-block')) {
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const range = document.createRange(); range.selectNodeContents(walker.currentNode);
            const count = range.getClientRects().length;
            for (let i = 0; i < count; i++) {
              let rect = range.getClientRects()[i]; if (!rect.width || !rect.height) continue;
              const stageRect = stage.getBoundingClientRect();
              stage.scrollTop += rect.top - stageRect.top - 12;
              rect = range.getClientRects()[i]; const visible = stage.getBoundingClientRect();
              let node = block, ok = rect.top >= Math.max(visible.top, 0) - 1 && rect.bottom <= Math.min(visible.bottom, innerHeight) + 1 && rect.left >= Math.max(visible.left, 0) - 1 && rect.right <= Math.min(visible.right, innerWidth) + 1;
              while (node && node !== stage) {
                const style = getComputedStyle(node), box = node.getBoundingClientRect();
                if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) ok = false;
                if (['hidden', 'clip'].includes(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) ok = false;
                if (['hidden', 'clip'].includes(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) ok = false;
                node = node.parentElement;
              }
              lines++; if (!ok) failures.push({ text: walker.currentNode.textContent.slice(0, 50), line: i });
            }
          }
        }
        stage.scrollTop = before; return { lines, failures };
      }, number);
      if (!visibility.lines || visibility.failures.length) collectionFailures.push(`scroll text cannot be fully exposed: ${JSON.stringify(visibility)}`);
      break;
    }
    const firstPage = Number(await page.locator('#book-spread > .paper-page').first().getAttribute('data-source-page'));
    if (firstPage > number || await page.locator('#next-page').isDisabled()) break;
    await page.locator('#next-page').click();
    await delay(100);
    if (turn === 99) throw new Error(`Continuation limit reached for ${fixture.name} page ${number}`);
  }
  if (!pieces.size) throw new Error(`No rendered leaves for ${fixture.name} page ${number}`);
  const collected = [...pieces.entries()].sort((a, b) => a[0] - b[0]).map(([, leaf]) => leaf);
  const blocks = collected.flatMap(leaf => leaf.blocks);
  for (let i = 1; i < blocks.length; i++) if (blocks[i].start < blocks[i - 1].end || blocks[i].start - blocks[i - 1].end > 2) collectionFailures.push(`overlap or gap in displayed source ranges ${blocks[i - 1].end}�${blocks[i].start}`);
  const actual = { text: blocks.map(b => b.text).join(' '), headings: blocks.filter(b => b.role === 'h3').map(b => b.text), visibility: blocks.map(({ start, end, ok, ratio }) => ({ start, end, ok, ratio })), introductions: collected.flatMap(leaf => leaf.intros), contents };
  const expected = { ...fixture.expected(number), contents: fixture.contents };
  const failures = [...compare(expected, actual), ...compareContents(fixture.contents, contents.stored), ...collectionFailures];
  if (blocks.some(b => b.role === 'h3' ? b.ratio < 1.15 : b.ratio > 1.15)) failures.push('heading or prose font size does not match its role');
  if (JSON.stringify(contents.displayed) !== JSON.stringify(expected.contents.map(n => n.title))) failures.push('displayed Contents titles differ');
  report.cases.push({ name: fixture.name, mode, viewport, page: number, expected, actual, failures, screenshots });
  console.log(`${failures.length ? 'FAIL' : 'PASS'} ${fixture.name} ${viewport} ${mode} p${number}${mutation ? ` mutation=${mutation}` : ''}: ${failures.join('; ')}`);
  return report.cases.at(-1);
}
try {
  await saveReport();
  await server.listen();
  context = await chromium.launchPersistentContext(path.join(run, 'profile'), { channel: process.env.FOLIO_CHROME_CHANNEL || 'chrome', headless: true, viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  report.browserVersion = context.browser()?.version() || 'unavailable';
  for (const fixture of checkerOnly ? cases.slice(0, 1) : cases) {
    const page = await context.newPage();
    page.on('pageerror', e => report.harnessErrors.push(`${fixture.name}: ${e.message}`));
    try {
      await page.goto(`http://127.0.0.1:${port}/tests/fidelity-check.html`);
      await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('demo')));
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.locator('#appearance-button[aria-valuenow]').waitFor({ timeout: 90000 });
      await importCase(page, fixture);
      const contents = await nodes(page);
      if (!checkerOnly) for (const [viewport, size] of [['desktop', { width: 1440, height: 960 }], ['narrow', { width: 320, height: 640 }]]) {
        await page.setViewportSize(size); await delay(300);
        for (const mode of ['pages', 'scroll']) {
          await page.locator(`#${mode}-layout`).click(); await delay(300);
          for (const number of fixture.checked) {
            try { await inspect(page, fixture, number, mode, viewport, contents); }
            catch (error) { report.harnessErrors.push(`${fixture.name} ${viewport} ${mode} p${number}: ${error.message}`); }
          }
        }
      }
      if (fixture.name === 'clean') {
        await page.setViewportSize({ width: 1440, height: 960 }); await delay(300);
        await page.locator('#pages-layout').click(); await delay(300);
        for (const mutation of ['hidden', 'clipped']) {
          // Reopen the page to discard the previous inline style and repaginate.
          await page.locator('#page-input').fill('2'); await page.locator('#page-input').press('Enter'); await settledReader(page, 2);
          const observed = await inspect(page, fixture, 1, 'pages', 'desktop', contents, mutation);
          report.cases.pop();
          const detected = observed.failures.includes('text is hidden or clipped');
          report.checkerValidation.push({ mutation, detected, screenshots: observed.screenshots });
          if (!detected) report.harnessErrors.push(`checker failed to detect ${mutation} text`);
        }
      }
    } catch (error) { report.harnessErrors.push(`${fixture.name}: ${error.message}`); }
    finally { await page.close(); await saveReport(); }
  }
} catch (error) { report.harnessErrors.push(error.stack || error.message); }
finally {
  await context?.close(); await server.close();
  if (report.cases.length !== report.planned || report.checkerValidation.length !== 2 || report.harnessErrors.length) report.status = 'incomplete';
  else report.status = report.cases.some(c => c.failures.length) ? 'fail' : 'pass';
  await saveReport();
}
console.log(`Report: ${path.join(run, 'report.html')}`);
console.log(`Product failures: ${report.cases.filter(c => c.failures.length).length}; harness errors: ${report.harnessErrors.length}`);
if (report.status !== 'pass') process.exitCode = 1;
