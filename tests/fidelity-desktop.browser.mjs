import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeEmphasisPdf, makeSpeechPdf, makeOcrPdf } from './fidelity-fixtures.mjs';

const root = process.cwd();
const artifacts = path.join(root, 'output/playwright/reader-fidelity');
await mkdir(artifacts, { recursive: true });
const run = await mkdtemp(path.join(artifacts, 'desktop-'));
const profile = path.join(run, 'profile');
let child, browser, page;
let failure = null;
const results = [];
const errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, label, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (predicate(value)) return value; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
async function launch() {
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [root,
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--headless'],
    { cwd: root, windowsHide: true, stdio: 'ignore' });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, Boolean, 'Electron CDP');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#file-input').waitFor({ state: 'attached' });
}
async function stop() {
  if (!child) return;
  const exiting = new Promise(resolve => child.once('exit', resolve));
  await page?.close().catch(() => {});
  await Promise.race([exiting, pause(3000)]);
  await browser?.close().catch(() => {});
  if (child.exitCode === null) { child.kill(); await Promise.race([exiting, pause(3000)]); }
  child = null; browser = null;
}
async function stored() {
  return page.evaluate(async () => {
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    if (!id || id === 'demo') return null;
    const read = (name, store) => new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(store), request = tx.objectStore(store).get(id);
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = () => reject(tx.error);
      };
    });
    const [book, place] = await Promise.all([read('folio-library', 'books'), read('folio-reading-places', 'places')]);
    if (!book) return null;
    const digest = await crypto.subtle.digest('SHA-256', book.bytes);
    const { bytes, ...metadata } = book;
    return { ...metadata, ...place, sha256: [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') };
  });
}
async function importPdf(file) {
  await page.locator('#file-input').setInputFiles(file);
  const title = path.basename(file, '.pdf');
  const book = await until(stored, b => b?.title === title && b.structure?.status === 'complete', `import ${title}`);
  assert.equal(book.sha256, createHash('sha256').update(await readFile(file)).digest('hex'));
  await settled(); return book;
}
async function settled() {
  await page.waitForFunction(() => {
    if (document.querySelector('#modal').open) return false;
    if (document.body.classList.contains('scroll-mode')) return !!document.querySelector('.scroll-page .layout-block, .scroll-page canvas');
    if (document.querySelector('#original-view').getAttribute('aria-pressed') === 'true') return !!document.querySelector('#original-stage canvas');
    return document.querySelector('#book-spread').getAttribute('aria-busy') === 'false' && !!document.querySelector('#book-spread .paper-page');
  });
}
async function jump(number) {
  await page.locator('#page-input').fill(String(number)); await page.locator('#page-input').press('Enter'); await settled();
  await page.locator('#page-input').blur();
  if (await page.locator('body').evaluate(node => node.classList.contains('scroll-mode'))) {
    await page.waitForFunction(() => document.querySelector('#scroll-stage').dataset.activeLoads === '0');
    await pause(850);
    assert.equal((await stored()).page, number, 'settled Scroll jump changed source page');
  }
}
async function shot(name) { await page.screenshot({ path: path.join(run, `${name}.png`), fullPage: true }); }
try {
  await launch();
  const sample = await importPdf(path.join(root, 'public/sample.pdf'));
  assert.deepEqual(sample.structure.nodes.map(n => n.title), ['The First Light', 'A quiet continuation.', 'A Slower Morning']);
  for (const mode of ['pages', 'scroll']) {
    await page.locator(`#${mode}-layout`).click(); await jump(1);
    const prose = page.locator(`${mode === 'pages' ? '#book-spread' : '#scroll-stage'} [data-source-page="1"] .page-prose`).first();
    assert.equal(((await prose.textContent()).match(/The First Light/g) ?? []).length, 1);
    assert.match(await prose.textContent(), /CHAPTER ONE/);
    await shot(`sample-${mode}`);
  }
  await page.locator('#pages-layout').click(); await page.locator('#original-view').click(); await settled(); await shot('sample-original');
  await page.locator('#book-view').click(); await settled();
  const first = sample.structure.nodes.find(n => n.title === 'The First Light');
  await page.locator(`[data-node-id="${first.id}"]`).click(); await settled();
  await page.locator('#bookmark-button').click();
  const samplePlace = await until(stored, b => b?.bookmarks.includes(1) && b.bookPosition?.contentsId === first.id, 'sample saved selection');
  results.push({ sample: 'both layouts, Original pixels, coherent Contents and selected source anchor', sha256: sample.sha256 });

  for (const [name, bytes, styled] of [
    ['Production mixed emphasis', makeEmphasisPdf(), true],
    ['Production verse and speech', makeSpeechPdf(), false],
    ['Production unreliable text', makeOcrPdf(), false],
  ]) {
    const file = path.join(run, `${name}.pdf`); await writeFile(file, bytes);
    const imported = await importPdf(file);
    for (const mode of ['pages', 'scroll']) {
      await page.locator(`#${mode}-layout`).click(); await settled(); await jump(1);
      if (styled) assert.ok(await page.locator('.layout-emphasis-bold, .layout-emphasis-italic').count(), 'production inline emphasis missing');
      await shot(`${name}-${mode}`);
    }
    if (name === 'Production unreliable text') {
      assert.match(await page.locator('.scroll-page[data-source-page="1"] .page-prose').textContent(), /Cod keeps/);
      const place = await stored();
      await page.locator('#text-help-button').click();
      assert.match(await page.locator('#modal-body').textContent(), /does not guess replacement words or run OCR/);
      await shot('production-ocr-help');
      await page.locator('#use-original-button').click(); await settled();
      assert.equal(await page.locator('#original-view').getAttribute('aria-pressed'), 'true');
      await shot('production-ocr-original');
      await page.locator('#book-view').click(); await settled();
      assert.equal((await stored()).bookPosition.page, place.bookPosition.page);
      await page.locator('#pages-layout').click(); await settled();
    }
    assert.equal((await stored()).sha256, imported.sha256);
    results.push({ fixture: name, bothLayouts: true, sha256: imported.sha256 });
  }

  const hamlet = await importPdf(path.join(root, 'testing_downloads/Hamlet.pdf'));
  for (const number of [10, 20, 50]) {
    for (const mode of ['pages', 'scroll']) {
      await page.locator(`#${mode}-layout`).click(); await settled(); await jump(number);
      await shot(`production-hamlet-${number}-${mode}`);
    }
  }
  results.push({ hamlet: 'source pages 10, 20 and 50 in both production layouts', sha256: hamlet.sha256 });
  await page.locator('#pages-layout').click(); await settled();

  const scan = await importPdf('C:/Users/ccorm/fall-26/pstat_120a/Shelley - Frankenstein.pdf');
  assert.equal(scan.structure.pageNavigation.length, 228);
  assert.ok(scan.structure.nodes.every(n => !/^\d+$/.test(n.title)));
  assert.equal(await page.locator('#book-view').isDisabled(), true);
  await page.locator('.page-bookmarks summary').click();
  await page.locator(`[data-page-bookmark="${scan.structure.pageNavigation[154].id}"]`).click(); await settled();
  await page.waitForFunction(() => document.querySelector('#page-input').value === '155'); await settled();
  assert.equal(await page.locator('#page-input').inputValue(), '155'); await shot('frankenstein-original');
  results.push({ frankenstein: '228 separated destinations, readable Original, destination155 navigates', sha256: scan.sha256 });

  const nietzsche = await importPdf('C:/Users/ccorm/Downloads/Additional reading Nietzsche Zarathustra Prologue.pdf');
  assert.equal(nietzsche.structure.nodes.length, 3);
  assert.equal(nietzsche.structure.nodes[2].parentId, nietzsche.structure.nodes[1].id);
  await page.locator('#appearance-button').press('Home');
  for (let i = 0; i < 7; i++) await page.locator('#appearance-button').press('ArrowRight');
  for (const number of [1, 3, 4, 17]) {
    await page.locator('#scroll-layout').click(); await jump(number);
    const source = page.locator(`.scroll-page[data-source-page="${number}"]`);
    await source.locator('.layout-block').first().waitFor();
    const summary = await source.evaluate(node => ({ text: node.querySelector('.page-prose').textContent,
      body: node.layoutModel.projection.text, notes: node.layoutModel.annotations.map(a => a.projection.text),
      headings: [...node.querySelectorAll('h3.layout-heading')].map(n => n.textContent) }));
    assert.ok(!summary.body.replace(/\s/g, '').includes('THUSSPOKEZARATHUSTRA'));
    assert.ok(summary.notes.length >= 1, `header notes on ${number}`);
    if (number === 1 || number === 17) assert.ok(summary.headings.some(t => /Zarathustra/.test(t)));
    await shot(`nietzsche-${number}-scroll`);
    await source.locator('.layout-source-notes').click();
    assert.match(await page.locator('#modal-body').textContent(), /THUS|ZARATH|\?/);
    await page.locator('#modal-close').click();
    await page.locator('#pages-layout').click(); await jump(number); await shot(`nietzsche-${number}-pages`);
  }
  const beforeRestart = await stored();
  await stop(); await launch();
  const afterRestart = await until(stored, b => b?.id === nietzsche.id && b.structure?.status === 'complete', 'desktop restart');
  await settled();
  assert.equal(afterRestart.sha256, nietzsche.sha256);
  assert.deepEqual(afterRestart.bookPosition, beforeRestart.bookPosition);
  await page.getByRole('button', { name: 'Read sample', exact: true }).click(); await settled();
  const restoredSample = await until(stored, b => b?.id === sample.id, 'switch back to sample');
  assert.equal(restoredSample.sha256, sample.sha256);
  assert.deepEqual(restoredSample.bookmarks, samplePlace.bookmarks);
  assert.equal(restoredSample.bookPosition.contentsId, first.id);
  results.push({ nietzsche: 'three hierarchical headings, header annotations, both layouts, restart and shelf switch', sha256: nietzsche.sha256 });
  await shot('sample-restored');
  assert.deepEqual(errors, [], 'production renderer errors');
  console.log(JSON.stringify({ passed: true, run, results }, null, 2));
} catch (error) {
  failure = error.stack ?? String(error);
  await shot('failure').catch(() => {}); console.error(error); process.exitCode = 1;
} finally {
  await writeFile(path.join(run, 'report.json'), JSON.stringify({ passed: !failure, results, errors, failure }, null, 2)); await stop();
}
