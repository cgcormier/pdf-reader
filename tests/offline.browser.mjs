import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../scripts/server.mjs';
import { settledReader, captureReader } from './reader-capture.mjs';
import { waitForAsync } from './browser-wait.mjs';

await mkdir('output/playwright/offline', {recursive:true});
const run = await mkdtemp('output/playwright/offline/run-');
const server = createServer(); let context, failure;
try {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port; assert.notEqual(port,4173);
  context = await chromium.launchPersistentContext(`${run}/profile`,{channel:'chrome',headless:true,viewport:{width:1440,height:1100}});
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${port}/`);
  await settledReader(page);
  await waitForAsync(page, async () => Boolean(await navigator.serviceWorker.ready), undefined, { label:'offline service worker ready' });
  await page.locator('#file-input').setInputFiles('public/sample.pdf');
  await page.waitForFunction(() => document.querySelector('#book-title').textContent === 'sample'
    && /4 of 4/.test(document.querySelector('#chapter-note').textContent));
  await settledReader(page,1);
  await new Promise(resolve => server.close(resolve));
  await page.reload(); await settledReader(page,1);
  assert.match(await page.locator('#book-spread').textContent(),/The First Light/);
  await captureReader(page,`${run}/offline-book.png`,1);
  await page.locator('#original-view').click(); await settledReader(page,1);
  await captureReader(page,`${run}/offline-original.png`,1);
  const storedHash = await page.evaluate(async () => {
    const id = JSON.parse(localStorage.getItem('folio:active-book'));
    const db = await new Promise((resolve,reject) => { const r=indexedDB.open('folio-library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
    const book = await new Promise((resolve,reject) => { const r=db.transaction('books').objectStore('books').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
    db.close();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',book.bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  });
  assert.equal(storedHash,createHash('sha256').update(await readFile('public/sample.pdf')).digest('hex'));
  console.log(`PASS production server-stopped reload, Book/Original, source bytes: ${run}`);
} catch (error) { failure=error.stack; process.exitCode=1; console.error(error); }
finally {
  await writeFile(`${run}/report.json`,JSON.stringify({status:failure?'failed':'passed',failure},null,2));
  await context?.close(); if(server.listening) await new Promise(resolve=>server.close(resolve));
}
