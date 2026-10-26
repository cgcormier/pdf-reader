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
if (issue !== '7') throw new Error(`Issue ${issue} is not implemented in this test group yet.`);
const executablePath = process.env.FOLIO_EXECUTABLE || (await import('electron')).default;
const profile = await mkdtemp(path.join(os.tmpdir(), 'folio-reader-recovery-'));
let app;
let browser;
let context;
let debugPage;

async function launch() {
  if (process.env.RECOVERY_BROWSER_URL) {
    browser = await chromium.launch({
      headless: process.env.FOLIO_HEADLESS !== '0',
      ...(process.env.FOLIO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.FOLIO_CHROMIUM_EXECUTABLE } : {}),
    });
    context = await browser.newContext();
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
  await browser?.close();
  const resolvedProfile = path.resolve(profile);
  assert.equal(path.dirname(resolvedProfile), path.resolve(os.tmpdir()), 'temporary profile stays directly under the OS temp directory');
  assert.ok(path.basename(resolvedProfile).startsWith('folio-reader-recovery-'), 'temporary profile has the recovery-test prefix');
  await rm(profile, { recursive: true, force: true });
}
