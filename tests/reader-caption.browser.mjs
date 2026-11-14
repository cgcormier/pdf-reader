import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
await mkdir('output/playwright/reader-caption', { recursive: true });
const output = await mkdtemp('output/playwright/reader-caption/run-');
const server = await createServer({ cacheDir: `${output}/vite-cache`, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [process.cwd(), await realpath('node_modules')] } }, clearScreen: false });
let browser;
try {
  await server.listen();
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.locator('#file-input').setInputFiles('public/sample.pdf');
  await page.waitForFunction(() => !document.querySelector('#original-view').disabled);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const layout of ['scroll', 'pages']) {
      await page.locator(`#${layout}-layout`).click();
      await page.locator('#original-view').click();
      await page.waitForFunction(() => document.querySelector('#reading-caption').hidden);
      assert.equal(await page.locator('#reading-caption').isVisible(), false);
      assert.equal(await page.locator('#reading-caption').evaluate(node => node.getBoundingClientRect().height), 0);
      await page.locator(`${layout === 'scroll' ? '#scroll-stage' : '#original-stage'} canvas`).first().waitFor();
      await page.keyboard.press('f');
      await page.waitForFunction(() => document.body.classList.contains('focus-mode'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.classList.contains('focus-mode'));
      assert.equal(await page.locator('#reading-caption').isVisible(), false);
      await page.screenshot({ path: `${output}/original-${layout}-${width}.png` });
      await page.locator('#book-view').click();
      await page.waitForFunction(() => !document.querySelector('#reading-caption').hidden);
      assert.equal(await page.locator('#reading-caption').isVisible(), true);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS original/book caption visibility, restoration, focus exit, canvas and mobile/desktop layouts.');
} finally { await browser?.close(); await server.close(); }
