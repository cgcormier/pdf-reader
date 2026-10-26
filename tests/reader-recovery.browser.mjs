// Focused reader-opening regressions. Run against the desktop app with
// `node tests/reader-recovery.browser.mjs`; RECOVERY_ISSUE selects one group.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issue = process.env.RECOVERY_ISSUE || process.argv[2] || '7';
if (!['5', '7'].includes(issue)) throw new Error(`Issue ${issue} is not implemented in this test group yet.`);
const executablePath = process.env.FOLIO_EXECUTABLE || (await import('electron')).default;
const profile = await mkdtemp(path.join(os.tmpdir(), 'folio-reader-recovery-'));
let app;
let browser;
let context;
let debugPage;

async function launch() {
  if (process.env.RECOVERY_BROWSER_URL) {
    if (!browser) {
      browser = await chromium.launch({
        headless: process.env.FOLIO_HEADLESS !== '0',
        ...(process.env.FOLIO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.FOLIO_CHROMIUM_EXECUTABLE } : {}),
      });
      context = await browser.newContext();
    }
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

async function waitForTitle(page, title) {
  await page.waitForFunction(title => document.querySelector('#book-title')?.textContent.includes(title), title);
}

async function waitForStructure(page, status) {
  await page.waitForFunction(status => {
    const note = document.querySelector('#chapter-note')?.textContent || '';
    return status === 'complete' ? /4 of 4/.test(note) : /Finding contents/.test(note);
  }, status);
}

async function waitForRescanReady(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector('#structure-tools > button');
    return button && !button.disabled && !button.hidden;
  });
}

async function delayNextStoredBookRead(page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let delayNext = true;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      const transaction = original.call(this, stores, mode, ...args);
      if (this.name !== 'folio-library' || mode !== 'readonly' || !delayNext) return transaction;
      const names = typeof stores === 'string' ? [stores] : [...stores];
      if (!names.includes('books')) return transaction;
      delayNext = false;
      let handler;
      Object.defineProperty(transaction, 'oncomplete', {
        configurable: true,
        get: () => handler,
        set: value => { handler = value; },
      });
      window.__folioOpenHoldReady = false;
      window.__folioReleaseOpenHold = () => {};
      transaction.addEventListener('complete', event => {
        event.stopImmediatePropagation();
        window.__folioOpenHoldReady = true;
        window.__folioReleaseOpenHold = () => handler?.call(transaction, event);
      }, { once: true });
      return transaction;
    };
  });
}

async function seedInvalidSavedBook(page) {
  await page.evaluate(async () => {
    const open = indexedDB.open('folio-library', 1);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('books', 'readwrite');
    tx.objectStore('books').put({
      id: 'reader-recovery-invalid', title: 'Broken saved book', filename: 'broken.pdf',
      bytes: new TextEncoder().encode('not a PDF').buffer,
      chapters: [{ title: 'Beginning', page: 1 }], bookmarks: [], page: 1, addedAt: Date.now(),
    });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  });
}

async function clickReadFromShelf(page, title, { delayRead = false } = {}) {
  await page.locator('#library-button').click();
  await page.locator('#modal[open]').waitFor({ state: 'visible' });
  const read = page.locator('.shelf-item').filter({ hasText: title }).getByRole('button', { name: /Read/ });
  if (delayRead) await delayNextStoredBookRead(page);
  await read.click();
  if (delayRead) await page.waitForFunction(() => window.__folioOpenHoldReady === true);
}

async function releaseStoredBookRead(page) {
  await page.evaluate(() => window.__folioReleaseOpenHold());
}

async function readPlace(page, id) {
  return page.evaluate(async id => {
    const request = indexedDB.open('folio-reading-places', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('places', 'readonly');
    const placeRequest = tx.objectStore('places').get(id);
    const place = await new Promise((resolve, reject) => {
      placeRequest.onsuccess = () => resolve(placeRequest.result);
      placeRequest.onerror = () => reject(placeRequest.error);
    });
    db.close();
    return place;
  }, id);
}

async function readBookRecord(page, id) {
  return page.evaluate(async id => {
    const request = indexedDB.open('folio-library', 1);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('books', 'readonly');
    const recordRequest = tx.objectStore('books').get(id);
    const record = await new Promise((resolve, reject) => {
      recordRequest.onsuccess = () => resolve(recordRequest.result);
      recordRequest.onerror = () => reject(recordRequest.error);
    });
    db.close();
    return record ? { ...record, bytes: Array.from(new Uint8Array(record.bytes)) } : undefined;
  }, id);
}

async function seedLegacyRecords(page, noViewBytes, originalViewBytes) {
  await page.evaluate(async ({ noViewBytes, originalViewBytes }) => {
    const openDb = (name, store) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const books = await openDb('folio-library', 'books');
    const tx = books.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    store.put({ id: 'reader-recovery-legacy-default', title: 'Legacy Default', filename: 'legacy-default.pdf',
      bytes: Uint8Array.from(noViewBytes).buffer, chapters: [{ title: 'Beginning', page: 1 }],
      page: 2, bookmarks: [2], addedAt: Date.now() });
    store.put({ id: 'reader-recovery-legacy-original', title: 'Legacy Original', filename: 'legacy-original.pdf',
      bytes: Uint8Array.from(originalViewBytes).buffer, chapters: [{ title: 'Beginning', page: 1 }],
      page: 2, bookmarks: [2], scrollPosition: { page: 2, fraction: 0, view: 'original' }, addedAt: Date.now() + 1 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    books.close();
    const places = await openDb('folio-reading-places', 'places');
    places.close();
  }, { noViewBytes: Array.from(noViewBytes), originalViewBytes: Array.from(originalViewBytes) });
}

async function waitForView(page, view) {
  const selector = view === 'book' ? '#book-view' : '#original-view';
  await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', selector);
}

async function waitForLayout(page, layout) {
  const selector = layout === 'pages' ? '#pages-layout' : '#scroll-layout';
  await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', selector);
}

async function waitForRenderedOriginal(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('#original-stage canvas, #scroll-stage canvas')]
    .some(canvas => canvas.width > 0 && canvas.height > 0));
}

async function setView(page, view) {
  await page.locator(view === 'book' ? '#book-view' : '#original-view').click();
  await waitForView(page, view);
  if (view === 'original') await waitForRenderedOriginal(page);
}

async function setLayout(page, layout) {
  await page.locator(layout === 'pages' ? '#pages-layout' : '#scroll-layout').click();
  await waitForLayout(page, layout);
}

async function jumpToPage(page, number) {
  const input = page.locator('#page-input');
  await input.fill(String(number));
  await input.press('Enter');
  await page.waitForFunction(number => document.querySelector('#page-input')?.value === String(number), number);
  if (await page.locator('#original-view').getAttribute('aria-pressed') === 'true') await waitForRenderedOriginal(page);
}

async function activeBookId(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('folio:active-book')));
}

async function restart(page) {
  if (app) {
    await app.close();
    app = null;
  } else {
    await page.close();
  }
  const next = await launch();
  debugPage = next;
  return next;
}

async function waitForBookLayout(page) {
  await page.waitForFunction(() => document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#book-spread > .paper-page'));
}

async function waitForBookView(page) {
  if (await page.locator('#scroll-layout').getAttribute('aria-pressed') === 'true') {
    await page.waitForFunction(() => document.querySelector('#scroll-stage .scroll-page .layout-block'));
  } else {
    await waitForBookLayout(page);
  }
}

async function waitForPlace(page, id, expected, message) {
  await page.waitForFunction(async ({ id, expected }) => {
    const open = indexedDB.open('folio-reading-places', 1);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('places', 'readonly');
    const request = tx.objectStore('places').get(id);
    const place = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return place && Object.entries(expected).every(([path, value]) => {
      const actual = path.split('.').reduce((current, key) => current?.[key], place);
      return actual === value;
    });
  }, { id, expected }, { timeout: 15_000 }).catch(error => {
    throw new Error(`Timed out waiting for saved place: ${message}. ${error.message}`);
  });
}

async function ensureBookmark(page) {
  const button = page.locator('#bookmark-button');
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await page.waitForFunction(() => document.querySelector('#bookmark-button')?.getAttribute('aria-pressed') === 'true');
}

async function assertState(page, view, layout) {
  await waitForView(page, view);
  await waitForLayout(page, layout);
  if (view === 'original') await waitForRenderedOriginal(page);
}

async function testIssue5(page) {
  const densePath = path.join(root, 'output', 'playwright', 'Folio-Dense-Book.pdf');
  const secondPath = path.join(root, 'output', 'playwright', 'Folio-Heading-Book.pdf');
  const denseBytes = await import('node:fs/promises').then(fs => fs.readFile(densePath));
  const secondBytes = await import('node:fs/promises').then(fs => fs.readFile(secondPath));

  await page.locator('#file-input').setInputFiles(densePath);
  await waitForTitle(page, 'Folio-Dense-Book');
  await waitForRescanReady(page);
  const denseId = await activeBookId(page);
  await assertState(page, 'book', 'pages');
  await jumpToPage(page, 1);
  await ensureBookmark(page);

  // Move within source page one until Book mode has a real nonzero source offset.
  let anchor;
  for (let turn = 0; turn < 8; turn++) {
    anchor = (await readPlace(page, denseId))?.bookPosition;
    if (anchor?.page === 1 && anchor.offset > 0) break;
    await page.locator('#next-page').click();
    await waitForBookLayout(page);
    await page.waitForFunction(async id => {
      const open = indexedDB.open('folio-reading-places', 1);
      const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      const tx = db.transaction('places', 'readonly'); const request = tx.objectStore('places').get(id);
      const place = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      db.close(); return Boolean(place?.bookPosition);
    }, denseId);
  }
  anchor = (await readPlace(page, denseId))?.bookPosition;
  assert.equal(anchor?.page, 1, `dense fixture must retain source page one while making an anchor, got ${JSON.stringify(anchor)}`);
  assert.ok(anchor.offset > 0, `dense fixture must produce a nonzero Book anchor, got ${anchor.offset}`);

  await setView(page, 'original');
  await setLayout(page, 'scroll');
  await jumpToPage(page, 1);
  await waitForPlace(page, denseId, { 'scrollPosition.page': 1, view: 'original', readingLayout: 'scroll' }, 'Original Scroll p1');
  await jumpToPage(page, 3);
  await waitForPlace(page, denseId, { 'scrollPosition.page': 3 }, 'Original navigation to p3');
  assert.deepEqual((await readPlace(page, denseId)).bookPosition, anchor, 'Original navigation to p3 preserves the nonzero Book anchor');
  await jumpToPage(page, 1);
  await waitForPlace(page, denseId, { 'scrollPosition.page': 1 }, 'Original navigation back to p1');
  assert.deepEqual((await readPlace(page, denseId)).bookPosition, anchor, 'Original p1 to p3 to p1 preserves the Book anchor');

  // Restart while Original is active and confirm the Book anchor remains untouched.
  page = await restart(page);
  await waitForTitle(page, 'Folio-Dense-Book');
  await assertState(page, 'original', 'scroll');
  assert.equal(await page.locator('#page-input').inputValue(), '1');
  await waitForPlace(page, denseId, { view: 'original', readingLayout: 'scroll', 'bookPosition.page': 1, 'bookPosition.offset': anchor.offset }, 'Original restart retains the Book anchor');
  assert.deepEqual((await readPlace(page, denseId)).bookPosition, anchor, 'full restart preserves the exact nonzero Book anchor while Original is active');

  await setView(page, 'book');
  await waitForBookView(page);
  await waitForPlace(page, denseId, { 'bookPosition.page': 1, 'bookPosition.offset': anchor.offset }, 'return to the same Book page');
  assert.deepEqual((await readPlace(page, denseId)).bookPosition, anchor, 'returning to Book on the same source page restores the saved anchor');
  await setLayout(page, 'pages');
  await waitForBookLayout(page);
  const restoredLeafRanges = await page.locator('#book-spread > .paper-page[data-source-page="1"]').evaluateAll(leaves =>
    leaves.map(leaf => ({ start: Number(leaf.dataset.textOffset), end: Number(leaf.dataset.textEnd) })));
  assert.ok(restoredLeafRanges.some(range => range.start <= anchor.offset && anchor.offset <= range.end),
    `restored Book spread must mount the leaf containing source offset ${anchor.offset}; got ${JSON.stringify(restoredLeafRanges)}`);

  // Switching back to Book on a different source page must not reuse page one's anchor.
  await setView(page, 'original');
  await jumpToPage(page, 3);
  await waitForPlace(page, denseId, { 'scrollPosition.page': 3 }, 'Original p3 before changing mode');
  await setView(page, 'book');
  await waitForBookView(page);
  await waitForPlace(page, denseId, { 'bookPosition.page': 3, 'bookPosition.offset': 0 }, 'Book mode on p3 has no stale p1 anchor');
  const pageThreePosition = (await readPlace(page, denseId)).bookPosition;
  assert.deepEqual({ page: pageThreePosition.page, offset: pageThreePosition.offset }, { page: 3, offset: 0 });

  // Original Pages on page three must also survive a full restart as visible page three.
  await setView(page, 'original');
  await setLayout(page, 'pages');
  await jumpToPage(page, 3);
  await page.locator('#original-stage canvas[aria-label="Original PDF page 3"]').waitFor({ state: 'visible' });
  page = await restart(page);
  await waitForTitle(page, 'Folio-Dense-Book');
  await assertState(page, 'original', 'pages');
  assert.equal(await page.locator('#page-input').inputValue(), '3', 'Original Pages restart restores page three');
  await page.locator('#original-stage canvas[aria-label="Original PDF page 3"]').waitFor({ state: 'visible' });
  await waitForPlace(page, denseId, { view: 'original', readingLayout: 'pages', 'scrollPosition.page': 3 }, 'Original Pages restart on p3');

  // Give this book a distinct saved mode/layout, then import a second document.
  await setView(page, 'original');
  await setLayout(page, 'scroll');
  await jumpToPage(page, 1);
  await ensureBookmark(page);
  await page.locator('#file-input').setInputFiles(secondPath);
  await waitForTitle(page, 'Folio-Heading-Book');
  await waitForRescanReady(page);
  const secondId = await activeBookId(page);
  await assertState(page, 'book', 'scroll');
  await setView(page, 'book');
  await setLayout(page, 'pages');
  await jumpToPage(page, 1);
  await ensureBookmark(page);

  // Shelf switching restores independent mode/layout state for both documents.
  await clickReadFromShelf(page, 'Folio-Dense-Book');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Folio-Dense-Book');
  await waitForRescanReady(page);
  await assertState(page, 'original', 'scroll');
  await setView(page, 'book');
  await setLayout(page, 'pages');
  await clickReadFromShelf(page, 'Folio-Heading-Book');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Folio-Heading-Book');
  await waitForRescanReady(page);
  await assertState(page, 'book', 'pages');
  await setView(page, 'original');
  await setLayout(page, 'scroll');
  await jumpToPage(page, 1);

  // A full application restart must recover the active document's state and shelf state.
  page = await restart(page);
  await waitForTitle(page, 'Folio-Heading-Book');
  await assertState(page, 'original', 'scroll');
  await waitForPlace(page, secondId, { view: 'original', readingLayout: 'scroll' }, 'second document after restart');
  await clickReadFromShelf(page, 'Folio-Dense-Book');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Folio-Dense-Book');
  await assertState(page, 'book', 'pages');
  await waitForPlace(page, denseId, { view: 'book', readingLayout: 'pages' }, 'first document after restart and shelf switch');
  await ensureBookmark(page);
  assert.equal((await readPlace(page, denseId)).bookmarks.includes(1), true, 'bookmark remains on the first PDF');

  // Old records without view fields inherit Book mode and the current global layout.
  await page.evaluate(() => localStorage.setItem('folio:reading-layout', JSON.stringify('scroll')));
  await seedLegacyRecords(page, denseBytes, secondBytes);
  await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('reader-recovery-legacy-default')));
  page = await restart(page);
  await waitForTitle(page, 'Legacy Default');
  await assertState(page, 'book', 'scroll');
  const legacyDefaultBefore = await readBookRecord(page, 'reader-recovery-legacy-default');
  assert.equal(legacyDefaultBefore.view, undefined);
  assert.equal(legacyDefaultBefore.readingLayout, undefined);
  await ensureBookmark(page);
  assert.equal((await readPlace(page, 'reader-recovery-legacy-default')).bookmarks.includes(2), true, 'legacy bookmark survives opening');

  // Old records with only scrollPosition.view retain Original mode while inheriting pages layout.
  await page.evaluate(() => localStorage.setItem('folio:reading-layout', JSON.stringify('pages')));
  await page.evaluate(() => localStorage.setItem('folio:active-book', JSON.stringify('reader-recovery-legacy-default')));
  page = await restart(page);
  await waitForTitle(page, 'Legacy Default');
  await setLayout(page, 'pages');
  await clickReadFromShelf(page, 'Legacy Original');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Legacy Original');
  await assertState(page, 'original', 'pages');
  const legacyOriginalBefore = await readBookRecord(page, 'reader-recovery-legacy-original');
  assert.equal(legacyOriginalBefore.view, undefined);
  assert.equal(legacyOriginalBefore.readingLayout, undefined);

  // Reading preferences and bookmarks never replace the original PDF bytes.
  const denseRecord = await readBookRecord(page, denseId);
  const secondRecord = await readBookRecord(page, secondId);
  assert.deepEqual(Buffer.from(denseRecord.bytes), denseBytes, 'first source bytes stay intact');
  assert.deepEqual(Buffer.from(secondRecord.bytes), secondBytes, 'second source bytes stay intact');
  assert.equal((await readPlace(page, denseId)).bookmarks.includes(1), true, 'first bookmark persists across full restart');
  assert.equal((await readPlace(page, secondId)).bookmarks.includes(1), true, 'second bookmark persists across full restart');

  console.log('Issue #5 passed: independent per-book modes and layouts survive shelf switches and full restarts; Original navigation preserves matching Book anchors, rejects stale mismatched anchors, legacy records fall back correctly, and bookmarks/source bytes remain intact.');
}

async function main() {
  let page = await launch();
  debugPage = page;
  assert.match(page.url(), /^(folio:\/\/app\/|http:\/\/127\.0\.0\.1:)/);

  const pdf = path.join(root, 'output', 'playwright', 'Folio-Test-Book.pdf');
  await page.locator('#file-input').setInputFiles(pdf);
  await waitForTitle(page, 'Folio-Test-Book');
  await waitForStructure(page, 'complete');
  await waitForRescanReady(page);
  const rescan = page.locator('#structure-tools > button').first();
  await rescan.waitFor({ state: 'visible' });
  assert.equal(await rescan.isEnabled(), true, 'completed imported book enables rescan');

  const secondPdf = path.join(root, 'output', 'playwright', 'Folio-Heading-Book.pdf');
  await page.locator('#file-input').setInputFiles(secondPdf);
  await waitForTitle(page, 'Folio-Heading-Book');
  await waitForStructure(page, 'complete');
  await page.waitForFunction(() => document.querySelector('#structure-tools > button')?.disabled === false);
  const secondRescan = page.locator('#structure-tools > button').first();

  await clickReadFromShelf(page, 'Folio-Test-Book', { delayRead: true });
  await page.getByRole('button', { name: 'Cancel' }).waitFor({ state: 'visible' });
  assert.equal(await secondRescan.isEnabled(), false, 'rescan disables while a saved PDF is reopening');
  await releaseStoredBookRead(page);
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Folio-Test-Book');
  await waitForStructure(page, 'complete');
  await waitForRescanReady(page);
  assert.equal(await page.locator('#structure-tools > button').first().isEnabled(), true, 'completed saved PDF enables rescan after reopening');

  const reopenedRescan = page.locator('#structure-tools > button').first();
  await page.evaluate(() => {
    const note = document.querySelector('#chapter-note');
    window.__folioSawScanStart = false;
    window.__folioScanObserver = new MutationObserver(() => {
      if (note.textContent.includes('Finding contents')) {
        window.__folioSawScanStart = true;
        const [scan, stop] = document.querySelector('#structure-tools').children;
        window.__folioScanControlsBlocked = scan.hidden && !stop.hidden;
      }
    });
    window.__folioScanObserver.observe(note, { childList: true, characterData: true, subtree: true });
  });
  await reopenedRescan.click();
  await page.waitForFunction(() => window.__folioSawScanStart === true);
  await page.evaluate(() => window.__folioScanObserver.disconnect());
  assert.equal(await page.evaluate(() => window.__folioScanControlsBlocked), true, 'rescan is unavailable while its scan is active');
  await waitForStructure(page, 'complete');
  await waitForRescanReady(page);
  assert.equal(await reopenedRescan.isEnabled(), true, 'rescan becomes available after its scan completes');

  await clickReadFromShelf(page, 'Folio-Heading-Book');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Folio-Heading-Book');
  await waitForStructure(page, 'complete');
  await waitForRescanReady(page);
  assert.equal(await page.locator('#structure-tools > button').first().isEnabled(), true, 'shelf switch leaves rescan available on the new book');

  await seedInvalidSavedBook(page);
  await clickReadFromShelf(page, 'Broken saved book');
  await page.waitForFunction(() => !document.querySelector('#modal').open
    && /could not be read/i.test(document.querySelector('#toast')?.textContent || ''));
  await waitForTitle(page, 'Folio-Heading-Book');
  await waitForRescanReady(page);
  await page.waitForFunction(() => document.querySelector('#structure-tools > button')?.disabled === false);
  assert.equal(await page.locator('#structure-tools > button').first().isEnabled(), true, 'failed saved-book opening leaves the current book recoverable');

  await clickReadFromShelf(page, 'Folio-Test-Book', { delayRead: true });
  await page.getByRole('button', { name: 'Cancel' }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#structure-tools > button').first().isEnabled(), false, 'rescan disables during a second reopen before cancellation');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await releaseStoredBookRead(page);
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await waitForTitle(page, 'Folio-Heading-Book');
  await waitForRescanReady(page);
  assert.equal(await page.locator('#structure-tools > button').first().isEnabled(), true, 'cancelled saved-book opening leaves rescan available');

  console.log('Issue #7 passed: completed import and saved-book reopen enable rescan; rescan starts and disables during scanning; failed and cancelled openings preserve access to the current book.');
}

try {
  if (issue === '7') await main();
  else await testIssue5(await launch());
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
  await browser?.close();
  const resolvedProfile = path.resolve(profile);
  assert.equal(path.dirname(resolvedProfile), path.resolve(os.tmpdir()), 'temporary profile stays directly under the OS temp directory');
  assert.ok(path.basename(resolvedProfile).startsWith('folio-reader-recovery-'), 'temporary profile has the recovery-test prefix');
  await rm(profile, { recursive: true, force: true });
}
