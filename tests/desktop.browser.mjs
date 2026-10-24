// Runs the real desktop app in an isolated, disposable shelf.
// Set FOLIO_EXECUTABLE to exercise an unpacked release instead of development.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Electron may download its development runtime on first use. Resolve that
// before starting Playwright's launch timeout; packaged tests need no download.
const executablePath = process.env.FOLIO_EXECUTABLE || (await import('electron')).default;
const profile = await mkdtemp(path.join(os.tmpdir(), 'folio-desktop-test-'));
const errors = [];
let app;

async function launch() {
  const args = [`--user-data-dir=${profile}`];
  if (!process.env.FOLIO_EXECUTABLE) args.unshift(root);
  if (process.env.FOLIO_HEADLESS === '1') args.push('--headless', '--ozone-platform=headless', '--disable-gpu');
  if (process.env.FOLIO_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  app = await electron.launch({
    executablePath,
    args,
    cwd: root,
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.waitForFunction(() => document.querySelector('#book-spread')?.textContent.trim()
    || document.querySelector('#original-stage canvas'));
  return page;
}

async function spreadAnchor(page) {
  await page.waitForFunction(() => document.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('#book-spread > .paper-page'));
  return page.locator('#book-spread > .paper-page').first().evaluate(leaf => ({
    page: Number(leaf.dataset.sourcePage), offset: Number(leaf.dataset.textOffset),
  }));
}

async function waitForSavedPlace(page, expected) {
  await page.waitForFunction(async expected => {
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('folio-reading-places');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const place = await new Promise((resolve, reject) => {
      const request = db.transaction('places').objectStore('places').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return place?.page === expected.page
      && (expected.offset === undefined || place.bookPosition?.offset === expected.offset)
      && (!expected.bookmark || place.bookmarks.includes(expected.page));
  }, expected);
}

try {
  let page = await launch();
  assert.equal(page.url(), 'folio://app/');
  const isolation = await app.evaluate(({ BrowserWindow, app }) => {
    const settings = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { node: settings.nodeIntegration, isolated: settings.contextIsolation, sandbox: settings.sandbox, profile: app.getPath('userData'), packaged: app.isPackaged };
  });
  assert.equal(isolation.node, false);
  assert.equal(isolation.isolated, true);
  assert.equal(isolation.sandbox, true);
  assert.equal(isolation.profile, profile);
  if (process.env.FOLIO_EXECUTABLE) assert.equal(isolation.packaged, true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');

  // The native window must read the built-in PDF through its custom protocol.
  await page.locator('#library-button').click();
  await page.getByRole('button', { name: 'Try a sample PDF' }).click();
  await page.waitForFunction(() => document.querySelector('#shelf-count')?.textContent === '1');
  await page.waitForFunction(() => document.querySelector('#book-title')?.textContent.includes('Light'));
  await page.waitForFunction(() => document.querySelectorAll('#chapter-list button').length > 0);

  // Keep the optimized Book-view source anchor across turns and a full restart.
  const opening = await spreadAnchor(page);
  await page.locator('#next-page').click();
  const turned = await spreadAnchor(page);
  assert.notDeepEqual(turned, opening);
  await waitForSavedPlace(page, turned);
  await app.close();
  app = null;
  page = await launch();
  await page.waitForFunction(() => document.querySelector('#book-title')?.textContent.includes('Light')
    && !document.querySelector('#modal').open);
  assert.deepEqual(await spreadAnchor(page), turned);
  await page.locator('#previous-page').click();
  assert.deepEqual(await spreadAnchor(page), opening);

  // Also exercise the actual file input, worker, original PDF canvas and saved place.
  await page.locator('#file-input').setInputFiles(path.join(root, 'testing_downloads', 'Hamlet.pdf'));
  await page.waitForFunction(() => document.querySelector('#shelf-count')?.textContent === '2');
  await page.waitForFunction(() => document.querySelector('#book-title')?.textContent.toLowerCase().includes('hamlet'));
  await page.locator('#original-view').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#original-stage canvas')].some(canvas => canvas.width > 0 && canvas.height > 0));
  await page.locator('#page-input').fill('3');
  await page.locator('#page-input').press('Enter');
  await page.waitForFunction(() => document.querySelector('#page-input').value === '3');
  await page.locator('#bookmark-button').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-button').getAttribute('aria-pressed') === 'true');
  await waitForSavedPlace(page, { page: 3, bookmark: true });
  if (!(await page.locator('#launch-help').isVisible())) await page.locator('#contents-toggle').click();
  await page.locator('#launch-help').click();
  assert.match(await page.locator('#modal-body').textContent(), /desktop app has its own shelf/);
  await page.locator('#modal-close').click();
  await mkdir(path.join(root, 'output'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'output', 'desktop-smoke.png') });

  await app.close();
  app = null;
  page = await launch();
  await page.waitForFunction(() => document.querySelector('#shelf-count')?.textContent === '2');
  await page.waitForFunction(() => document.querySelector('#book-title')?.textContent.toLowerCase().includes('hamlet'));
  await page.waitForFunction(() => document.querySelector('#page-input').value === '3');
  await page.waitForFunction(() => document.querySelector('#bookmark-button').getAttribute('aria-pressed') === 'true');
  assert.deepEqual(errors, []);
  console.log('Desktop smoke passed: renderer isolation, Book-view turns and anchor restoration, bundled PDF, file import, PDF rendering, bookmark and shelf persistence across full restarts.');
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(await page.locator('body').innerText());
    console.error('Page errors:', errors);
  }
  throw error;
} finally {
  if (app) await app.close();
  await rm(profile, { recursive: true, force: true });
}
