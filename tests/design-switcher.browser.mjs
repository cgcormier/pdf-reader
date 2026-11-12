import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
await mkdir('output/playwright/design-switcher', { recursive:true });
const output=await mkdtemp('output/playwright/design-switcher/run-');
const server=await createServer({cacheDir:`${output}/vite-cache`,server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{allow:[process.cwd(),await realpath('node_modules')]}},clearScreen:false});
let browser;
try {
 await server.listen();
 browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
 await page.locator('#book-spread[aria-busy="false"] > .paper-page').first().waitFor();
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:900});
  for(const design of ['current','margin-house','signal-studio','common-ground']) {
   const before=await page.locator('#book-spread').textContent();
   await page.locator('#reader-design-button').click();
   await page.locator(`[data-design-choice="${design}"]`).click();
   assert.equal(await page.locator('body').getAttribute('data-reader-design'),design);
   await page.keyboard.press('ArrowRight');
   assert.equal(await page.locator('#book-spread').textContent(),before,'modal arrows must not turn book');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#reader-design-dialog').evaluate(e=>e.open),false);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'reader-design-button');
   assert.equal(await page.locator('#book-spread').textContent(),before,'switch must preserve page');
   const bounds=await page.locator('#reader-design-button').boundingBox();
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'design trigger within viewport');
   await page.screenshot({path:`${output}/${width}-${design}.png`});
   await page.locator('#paper-button').click();
   await page.screenshot({path:`${output}/${width}-${design}-dark.png`});
   await page.locator('#paper-button').click();
   await page.locator('#focus-button').click();
   await page.locator('body.focus-mode').waitFor();
   assert.equal(await page.locator('#reader-design-button').isVisible(),false);
   await page.keyboard.press('Escape');
   await page.locator('#focus-button').hover();
   await page.locator('#immersive-button').click();
   await page.locator('body.immersive-mode').waitFor({timeout:3000});
   assert.equal(await page.locator('#reader-design-button').isVisible(),false);
   await page.locator('#immersive-page-number').click();
  }
 }
 assert.deepEqual(errors,[]); console.log(`PASS design browser matrix; screenshots ${output}`);
} finally { await browser?.close(); await server.close(); }
