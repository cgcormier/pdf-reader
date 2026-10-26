// Scan fallback regressions for image-only and mixed text/image PDFs.
// Run with `node tests/create-fixtures.mjs` then `node tests/scan-fallback.browser.mjs`.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(os.tmpdir(), 'folio-scan-fallback-'));
const executablePath = process.env.FOLIO_EXECUTABLE || (await import('electron')).default;
let app;
let context;
let debugPage;

async function launch() {
  if (process.env.RECOVERY_BROWSER_URL) {
    const chromePath = process.env.FOLIO_CHROMIUM_EXECUTABLE
      || (await Promise.all([
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ].map(async candidate => {
        try { await access(candidate); return candidate; } catch { return null; }
      }))).find(Boolean);
    context = await chromium.launchPersistentContext(profile, {
      headless: process.env.FOLIO_HEADLESS !== '0',
      ...(chromePath ? { executablePath: chromePath } : {}),
    });
    const page = await context.newPage();
    await page.goto(process.env.RECOVERY_BROWSER_URL);
    await page.waitForFunction(() => document.querySelector('#book-title'));
    return page;
  }
  const args = [`--user-data-dir=${profile}`];
  if (!process.env.FOLIO_EXECUTABLE) args.unshift(root);
  if (process.env.FOLIO_HEADLESS !== '0') args.push('--headless', '--ozone-platform=headless', '--disable-gpu');
  if (process.env.FOLIO_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  app = await electron.launch({ executablePath, args, cwd: root, timeout: 30_000 });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(() => document.querySelector('#book-title'));
  return page;
}

async function restart(page) {
  if (app) {
    await app.close();
    app = null;
  } else {
    await page.close();
    await context?.close();
    context = null;
  }
  return launch();
}

async function waitForTitle(page, title) {
  await page.waitForFunction(title => document.querySelector('#book-title')?.textContent.includes(title), title);
}

async function waitForAnalysis(page) {
  await page.waitForFunction(() => {
    const note = document.querySelector('#chapter-note')?.textContent || '';
    return /\b3 of 3 pages checked\b/.test(note)
      || (/No readable headings found/i.test(note)
        && document.querySelector('#original-view')?.getAttribute('aria-pressed') === 'true');
  });
}

async function waitForPageInput(page, number) {
  await page.waitForFunction(number => Number(document.querySelector('#page-input')?.value) === number, number);
}

async function waitForBookSpread(page) {
  await page.waitForFunction(() => document.querySelector('#book-view')?.getAttribute('aria-pressed') !== 'true'
    || document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false');
}

async function goToPage(page, number) {
  await page.locator('#page-input').fill(String(number));
  await page.locator('#page-input').press('Enter');
  await waitForPageInput(page, number);
  await waitForBookSpread(page);
}

async function canvasWithPixels(page, selector) {
  const canvas = page.locator(selector).first();
  await canvas.waitFor({ state: 'visible' });
  const pixels = await canvas.evaluate(element => {
    const context = element.getContext('2d');
    if (!context || !element.width || !element.height) return { width: element.width, height: element.height, saturated: 0, nonWhite: 0 };
    const data = context.getImageData(0, 0, element.width, element.height).data;
    let saturated = 0;
    let nonWhite = 0;
    const stride = Math.max(1, Math.floor((element.width * element.height) / 12000));
    for (let pixel = 0; pixel < element.width * element.height; pixel += stride) {
      const offset = pixel * 4;
      const red = data[offset]; const green = data[offset + 1]; const blue = data[offset + 2];
      if (Math.min(red, green, blue) < 238) nonWhite++;
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 55 && Math.min(red, green, blue) < 220) saturated++;
    }
    return { width: element.width, height: element.height, saturated, nonWhite };
  });
  assert.ok(pixels.width > 0 && pixels.height > 0, `${selector} has a raster backing store`);
  assert.ok(pixels.saturated > 100, `${selector} contains visible colored scan pixels, got ${JSON.stringify(pixels)}`);
  assert.ok(pixels.nonWhite > 100, `${selector} is not a blank white canvas, got ${JSON.stringify(pixels)}`);
  return canvas;
}

async function waitForSavedPlace(page, expected) {
  await page.waitForFunction(async expected => {
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    const open = indexedDB.open('folio-reading-places');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const place = await new Promise((resolve, reject) => {
      const request = db.transaction('places').objectStore('places').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return place?.page === expected.page
      && (!expected.view || place.view === expected.view)
      && (!expected.readingLayout || place.readingLayout === expected.readingLayout)
      && (!expected.bookmark || place.bookmarks?.includes(expected.page));
  }, expected);
}

async function forceLegacyBookPlace(page) {
  await page.evaluate(async () => {
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    const open = indexedDB.open('folio-reading-places');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('places', 'readwrite');
    const store = tx.objectStore('places');
    const request = store.get(id);
    request.onsuccess = () => store.put({
      ...request.result,
      id,
      page: 2,
      view: 'book',
      readingLayout: 'pages',
      bookmarks: [2],
      scrollPosition: { page: 2, fraction: 0, view: 'book' },
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
}

async function waitForSavedCurrentStructure(page, title) {
  return page.waitForFunction(async ({ title, expectedVersion }) => {
    const openDb = name => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (db, store, key) => new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const library = await openDb('folio-library');
    const books = await new Promise((resolve, reject) => {
      const request = library.transaction('books').objectStore('books').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const book = books.find(item => item.title === title);
    library.close();
    if (!book) return false;
    const placesDb = await openDb('folio-reading-places');
    const place = await read(placesDb, 'places', book.id);
    placesDb.close();
    const structure = place?.structure;
    return structure?.status === 'complete'
      && structure.textPages > 0
      && structure.scannedPages?.length === 3
      && structure.version === expectedVersion;
  }, { title, expectedVersion: await page.evaluate(async title => {
    const open = indexedDB.open('folio-library');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const books = await new Promise((resolve, reject) => {
      const request = db.transaction('books').objectStore('books').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return books.find(book => book.title === title)?.structure?.version;
  }, title) });
}

async function seedStaleMixedStructure(page, title) {
  return page.evaluate(async title => {
    const openDb = name => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const library = await openDb('folio-library');
    const books = await new Promise((resolve, reject) => {
      const request = library.transaction('books').objectStore('books').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const book = books.find(item => item.title === title);
    library.close();
    if (!book) throw new Error(`Could not find stored book ${title}`);
    const placesDb = await openDb('folio-reading-places');
    const tx = placesDb.transaction('places', 'readwrite');
    const store = tx.objectStore('places');
    const request = store.get(book.id);
    let expectedVersion;
    request.onsuccess = () => {
      const place = request.result;
      const structure = place?.structure;
      if (structure?.status !== 'complete' || structure.textPages < 1 || structure.scannedPages?.length !== 3) {
        tx.abort();
        return;
      }
      expectedVersion = structure.version;
      store.put({
        ...place,
        page: 1,
        view: 'book',
        readingLayout: 'pages',
        scrollPosition: { page: 1, fraction: 0, view: 'book' },
        structure: {
          ...structure,
          version: expectedVersion - 1,
          status: 'complete',
          textPages: 0,
          scannedPages: [1, 2, 3],
          failedPages: [],
        },
      });
    };
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Stored mixed structure was not complete before seeding.'));
    });
    placesDb.close();
    return { id: book.id, expectedVersion, staleVersion: expectedVersion - 1 };
  }, title);
}

async function openBookFromShelf(page, title) {
  await page.locator('#library-button').click();
  const item = page.locator('.shelf-item').filter({ hasText: title });
  await item.getByRole('button', { name: /Read/ }).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
}

async function main() {
  let page = await launch();
  debugPage = page;
  const screenshots = path.join(root, 'output', 'playwright', 'recovery');
  await mkdir(screenshots, { recursive: true });

  await page.locator('#file-input').setInputFiles(path.join(root, 'output', 'playwright', 'Folio-Scanned-Book.pdf'));
  await waitForTitle(page, 'Folio-Scanned-Book');
  await waitForAnalysis(page);
  assert.equal(await page.locator('#original-view').getAttribute('aria-pressed'), 'true', 'completed image-only analysis opens the readable Original PDF view');
  assert.equal(await page.locator('#page-input').getAttribute('max'), '3');
  await canvasWithPixels(page, '#original-stage canvas');
  await page.screenshot({ path: path.join(screenshots, 'scan-only-original-page-1.png') });

  // Original mode keeps source-page navigation one scan at a time.
  await page.locator('#next-page').click();
  await waitForPageInput(page, 2);
  await canvasWithPixels(page, '#original-stage canvas[aria-label="Original PDF page 2"]');
  await page.screenshot({ path: path.join(screenshots, 'scan-only-original-page-2.png') });
  await page.locator('#next-page').click();
  await waitForPageInput(page, 3);
  assert.equal(await page.locator('#next-page').isDisabled(), true, 'next is disabled at the third scanned source page');
  await page.locator('#previous-page').click();
  await waitForPageInput(page, 2);
  await page.locator('#bookmark-button').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-button')?.getAttribute('aria-pressed') === 'true');
  await waitForSavedPlace(page, { page: 2, view: 'original', bookmark: true });

  await page.locator('#scroll-layout').click();
  await page.waitForFunction(() => document.body.classList.contains('scroll-mode'));
  await canvasWithPixels(page, '#scroll-stage canvas[aria-label="Original PDF page 2"]');
  await waitForSavedPlace(page, { page: 2, view: 'original', readingLayout: 'scroll', bookmark: true });

  page = await restart(page);
  debugPage = page;
  await waitForTitle(page, 'Folio-Scanned-Book');
  await waitForPageInput(page, 2);
  assert.equal(await page.locator('#original-view').getAttribute('aria-pressed'), 'true', 'Original view survives a full desktop restart');
  assert.equal(await page.locator('#scroll-layout').getAttribute('aria-pressed'), 'true', 'scroll layout survives a full desktop restart');
  await canvasWithPixels(page, '#scroll-stage canvas, #original-stage canvas');

  await forceLegacyBookPlace(page);
  page = await restart(page);
  debugPage = page;
  await waitForTitle(page, 'Folio-Scanned-Book');
  await waitForPageInput(page, 2);
  assert.equal(await page.locator('#original-view').getAttribute('aria-pressed'), 'true', 'legacy completed no-text records stored as Book reopen in Original view');
  assert.equal(await page.locator('#pages-layout').getAttribute('aria-pressed'), 'true', 'legacy Book place retains its saved page layout');
  assert.equal(await page.locator('#bookmark-button').getAttribute('aria-pressed'), 'true', 'legacy fallback keeps the saved page-two bookmark');
  await canvasWithPixels(page, '#original-stage canvas[aria-label="Original PDF page 2"]');
  await page.screenshot({ path: path.join(screenshots, 'scan-only-legacy-book-restored.png') });

  await page.locator('#file-input').setInputFiles(path.join(root, 'output', 'playwright', 'Folio-Mixed-Scan-Book.pdf'));
  await waitForTitle(page, 'Folio-Mixed-Scan-Book');
  await waitForAnalysis(page);
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'a mixed text and scan PDF stays in Book view');
  await page.locator('#pages-layout').click();
  await goToPage(page, 1);
  await page.waitForSelector('.paper-page[data-source-page="1"] .page-prose');
  assert.match(await page.locator('.paper-page[data-source-page="1"] .page-prose').innerText(), /reflowed prose/i);
  await goToPage(page, 2);
  const scanCanvas = page.locator('#book-spread .paper-page.scan-page[data-source-page="2"] canvas');
  await scanCanvas.waitFor({ state: 'visible' });
  assert.match(await scanCanvas.getAttribute('aria-label'), /Original PDF page 2/i);
  await canvasWithPixels(page, '#book-spread .paper-page.scan-page[data-source-page="2"] canvas');
  await page.screenshot({ path: path.join(screenshots, 'mixed-scan-page-paged.png') });
  await page.evaluate(() => {
    const spread = document.querySelector('#book-spread');
    window.__scanFallbackSpreadResized = false;
    window.__scanFallbackResizeObserver = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) window.__scanFallbackSpreadResized = true;
    });
    window.__scanFallbackResizeObserver.observe(spread, { childList: true });
  });
  await page.setViewportSize({ width: 420, height: 850 });
  await page.waitForFunction(() => window.__scanFallbackSpreadResized
    && document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#book-spread .paper-page.scan-page[data-source-page="2"] canvas'));
  await page.evaluate(() => window.__scanFallbackResizeObserver.disconnect());
  if (await page.locator('body').evaluate(body => body.classList.contains('contents-open'))) {
    await page.locator('#contents-close').click();
  }
  await page.waitForFunction(() => !document.body.classList.contains('contents-open')
    && (document.querySelector('#book-contents')?.getBoundingClientRect().right ?? 1) <= 0);
  await canvasWithPixels(page, '#book-spread .paper-page.scan-page[data-source-page="2"] canvas');
  await page.screenshot({ path: path.join(screenshots, 'mixed-scan-page-narrow.png') });
  const scanBounds = await scanCanvas.boundingBox();
  assert.ok(scanBounds && scanBounds.x >= 0 && scanBounds.x + scanBounds.width <= 420,
    `narrow scan canvas stays inside the viewport: ${JSON.stringify(scanBounds)}`);

  // Page turns borrow the live canvas along with the leaf; verify its pixels survive.
  await page.locator('#next-page').click();
  await waitForPageInput(page, 3);
  await waitForBookSpread(page);
  assert.match(await page.locator('#book-spread .paper-page[data-source-page="3"] .page-prose').innerText(), /remains in Book view/i);
  await page.locator('#previous-page').click();
  await waitForPageInput(page, 2);
  await waitForBookSpread(page);
  await canvasWithPixels(page, '#book-spread .paper-page.scan-page[data-source-page="2"] canvas');

  await page.locator('#scroll-layout').click();
  await page.waitForFunction(() => document.body.classList.contains('scroll-mode'));
  await page.locator('#previous-page').click();
  await waitForPageInput(page, 1);
  await waitForBookSpread(page);
  await page.waitForFunction(() => /reflowed prose/i.test(document.querySelector('#scroll-stage .paper-page[data-source-page="1"] .page-prose')?.innerText || ''));
  await page.locator('#next-page').click();
  await waitForPageInput(page, 2);
  await waitForBookSpread(page);
  await canvasWithPixels(page, '#scroll-stage .paper-page.scan-page[data-source-page="2"] canvas');

  await goToPage(page, 3);
  await page.waitForSelector('#scroll-stage .paper-page[data-source-page="3"] .page-prose');
  assert.match(await page.locator('#scroll-stage .paper-page[data-source-page="3"] .page-prose').innerText(), /remains in Book view/i);
  await goToPage(page, 2);
  await page.locator('#bookmark-button').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-button')?.getAttribute('aria-pressed') === 'true');
  await waitForSavedPlace(page, { page: 2, view: 'book', bookmark: true });

  await page.waitForSelector('#scroll-stage .paper-page.scan-page canvas');
  await canvasWithPixels(page, '#scroll-stage .paper-page.scan-page canvas');
  await page.screenshot({ path: path.join(screenshots, 'mixed-scan-scroll.png') });
  await page.waitForSelector('#scroll-stage .paper-page[data-source-page="1"] .page-prose');
  await page.waitForSelector('#scroll-stage .paper-page[data-source-page="3"] .page-prose');
  await waitForSavedPlace(page, { page: 2, view: 'book', readingLayout: 'scroll', bookmark: true });

  page = await restart(page);
  debugPage = page;
  await waitForTitle(page, 'Folio-Mixed-Scan-Book');
  await waitForPageInput(page, 2);
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'mixed PDF remains in Book view after restart');
  assert.equal(await page.locator('#scroll-layout').getAttribute('aria-pressed'), 'true', 'mixed PDF returns to saved scroll layout');
  await page.waitForSelector('#scroll-stage .paper-page.scan-page canvas');
  await canvasWithPixels(page, '#scroll-stage .paper-page.scan-page canvas');
  await page.screenshot({ path: path.join(screenshots, 'mixed-scan-after-restart.png') });
  await page.locator('#bookmark-button').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#bookmark-button').getAttribute('aria-pressed'), 'true', 'scanned source-page bookmark survives restart');

  await page.locator('#file-input').setInputFiles(path.join(root, 'output', 'playwright', 'Folio-Mixed-Scan-First-Book.pdf'));
  await waitForTitle(page, 'Folio-Mixed-Scan-First-Book');
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'a scan-first document starts in Book view before its text scan completes');
  await waitForAnalysis(page);
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'later text pages keep a scan-first document in Book view after analysis');
  await page.locator('#pages-layout').click();
  await goToPage(page, 1);
  await page.waitForSelector('#book-spread .paper-page.scan-page[data-source-page="1"] canvas');
  await canvasWithPixels(page, '#book-spread .paper-page.scan-page[data-source-page="1"] canvas');
  await goToPage(page, 2);
  await page.waitForFunction(() => /readable source text/i.test(document.querySelector('.paper-page[data-source-page="2"] .page-prose')?.innerText || ''));
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'text following the opening scan remains reflowed');

  await waitForSavedCurrentStructure(page, 'Folio-Mixed-Scan-Book');
  const stale = await seedStaleMixedStructure(page, 'Folio-Mixed-Scan-Book');
  assert.equal(stale.staleVersion, stale.expectedVersion - 1, 'fixture stores the completed mixed analysis one detector version behind');
  await openBookFromShelf(page, 'Folio-Mixed-Scan-Book');
  await waitForTitle(page, 'Folio-Mixed-Scan-Book');
  await waitForPageInput(page, 1);
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'stale textless metadata does not force a valid mixed PDF into Original before rescan');
  await waitForSavedCurrentStructure(page, 'Folio-Mixed-Scan-Book');
  await waitForBookSpread(page);
  await page.waitForFunction(() => /reflowed prose/i.test(document.querySelector('#book-spread .paper-page[data-source-page="1"] .page-prose')?.innerText || ''));
  assert.equal(await page.locator('#book-view').getAttribute('aria-pressed'), 'true', 'automatic current-version rescan keeps mixed text in Book view');
  console.log('Issue #4 passed: image-only pages, legacy and current-version rescans, mixed scan positions, Book reflow, responsive sizing, navigation, and saved-place restart recovery.');
}

try {
  await main();
} catch (error) {
  if (app) {
    try { console.error(await (await app.firstWindow()).locator('body').innerText()); } catch {}
  }
  if (debugPage && !app) {
    try { console.error(`URL ${debugPage.url()}\n${await debugPage.locator('body').innerText()}`); } catch {}
  }
  throw error;
} finally {
  if (app) await app.close();
  await context?.close();
  const resolvedProfile = path.resolve(profile);
  assert.equal(path.dirname(resolvedProfile), path.resolve(os.tmpdir()), 'temporary profile stays directly under the OS temp directory');
  assert.ok(path.basename(resolvedProfile).startsWith('folio-scan-fallback-'), 'temporary profile has the scan-fallback-test prefix');
  await rm(profile, { recursive: true, force: true });
}
