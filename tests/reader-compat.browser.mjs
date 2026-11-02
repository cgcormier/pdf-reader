import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createServer as tcpServer } from 'node:net';
const base = 'output/playwright/reader-fidelity';
await mkdir(base, { recursive: true });
const directory = await mkdtemp(`${base}/compat-`);
const reserve = tcpServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const server = await createServer({ cacheDir: `${directory}/vite-cache`, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null } });
let browser;
const reports = [];
try {
  await server.listen();
  assert.notEqual(port, 4173); console.log(`Isolated origin http://127.0.0.1:${port}; ${directory}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const fixture of ['page-flip-check.html', 'layout-check.html']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    try {
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Warm Vite's module transforms before the fixtures' bounded iframe load.
      // Each run still owns a fresh origin, browser context and dependency cache.
      await page.goto(`http://127.0.0.1:${port}/tests/fidelity-check.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.locator('#appearance-button[role="slider"]').waitFor({ timeout: 90_000 });
      await page.goto(`http://127.0.0.1:${port}/tests/${fixture}`);
      await page.locator('#run').click();
      await page.waitForFunction(() => /ALL .* CHECKS PASSED|FAIL /.test(document.querySelector('#result').textContent), null, { timeout: 180000 });
      const result = await page.locator('#result').textContent();
      reports.push({ fixture, result, errors });
      assert.match(result, /ALL .* CHECKS PASSED/); assert.deepEqual(errors, []);
      await page.screenshot({ path: `${directory}/${fixture}.png` });
      console.log(result);
    } finally { await context.close(); }
  }
  console.log(`Evidence: ${directory}`);
} finally {
  await writeFile(`${directory}/report.json`, JSON.stringify(reports, null, 2));
  await browser?.close(); await server.close();
}
