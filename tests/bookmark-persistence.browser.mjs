import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertBuildExists, createServer } from '../scripts/server.mjs';
import { waitForAsync } from './browser-wait.mjs';
import { settledReader } from './reader-capture.mjs';

const distDirectory = path.resolve(process.argv[2] ?? 'dist');
await assertBuildExists(distDirectory);
const server = createServer({ distDirectory });
let browser;

async function waitForPlace(tab, conditions, label) {
  return waitForAsync(tab, async ({ page, layout, include, exclude, scrollFrom, withScroll }) => {
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('folio-reading-places');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const place = await new Promise((resolve, reject) => {
        const request = db.transaction('places').objectStore('places').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!place || page !== undefined && place.page !== page
        || layout !== undefined && place.readingLayout !== layout
        || include !== undefined && !place.bookmarks?.includes(include)
        || exclude !== undefined && place.bookmarks?.includes(exclude)
        || withScroll && !place.scrollPosition
        || scrollFrom && (!place.scrollPosition
          || place.scrollPosition.page === scrollFrom.page
            && place.scrollPosition.fraction === scrollFrom.fraction)) return null;
      return place;
    } finally {
      db.close();
    }
  }, conditions, { label });
}

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1100 } });
  const reader = await context.newPage();
  await reader.goto(url);
  await settledReader(reader, 1);
  await reader.locator('#file-input').setInputFiles(path.join(distDirectory, 'sample.pdf'));
  await reader.waitForFunction(() => document.querySelector('#book-title').textContent === 'sample'
    && /4 of 4/.test(document.querySelector('#chapter-note').textContent));
  await settledReader(reader, 1);

  const editor = await context.newPage();
  await editor.goto(url);
  await editor.getByRole('heading', { name: 'sample', exact: true }).waitFor();
  await settledReader(editor, 1);
  await reader.locator('#scroll-layout').click();
  await settledReader(reader, 1);
  const initial = await waitForPlace(reader, { layout: 'scroll', withScroll: true }, 'initial scroll place');

  await editor.locator('#bookmark-button').click();
  await waitForPlace(editor, { include: 1 }, 'page one bookmark');

  // The reader tab still holds the pre-bookmark document state.
  await reader.locator('#scroll-stage').evaluate(stage => { stage.scrollTop += stage.clientHeight / 2; });
  const scrolled = await waitForPlace(reader, { layout: 'scroll', scrollFrom: initial.scrollPosition }, 'scrolled reading place');
  assert.deepEqual(scrolled.bookmarks, [1], 'Scroll autosave must preserve a bookmark from another tab');

  await reader.locator('#pages-layout').click();
  const paged = await settledReader(reader);
  const switched = await waitForPlace(reader, { layout: 'pages' }, 'Page flip layout save');
  assert.deepEqual(switched.bookmarks, [1], 'Layout change must preserve a bookmark from another tab');

  const destination = paged.number === 3 ? 4 : 3;
  const pageInput = reader.locator('#page-input');
  await pageInput.fill(String(destination));
  await pageInput.press('Enter');
  await settledReader(reader, destination);
  const jumped = await waitForPlace(reader, { page: destination }, 'direct navigation save');
  assert.deepEqual(jumped.bookmarks, [1], 'Page-number navigation must preserve a bookmark from another tab');

  await reader.locator('#bookmark-button').click();
  const added = await waitForPlace(reader, { include: destination }, 'bookmark from stale reader tab');
  assert.deepEqual(added.bookmarks, [1, destination], 'Adding a bookmark must preserve bookmarks added in another tab');

  await editor.locator('#bookmark-button').click();
  const removed = await waitForPlace(editor, { include: destination, exclude: 1 }, 'bookmark removal from stale editor tab');
  assert.deepEqual(removed.bookmarks, [destination], 'Removing one bookmark must preserve unrelated bookmarks');
  assert.equal(removed.page, destination, 'A bookmark edit must preserve the reading place saved by another tab');

  console.log('PASS same-origin tabs preserve bookmarks through Scroll, Page flip, direct navigation, and stale bookmark edits');
} finally {
  try { await browser?.close(); }
  finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
