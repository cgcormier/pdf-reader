/** Focus exits preserve deliberate navigation; other cancellations retain their contract. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const output = 'output/playwright/focus-navigation';
await mkdir(output, {recursive:true});
const run = await mkdtemp(`${output}/run-`);
const server = await createServer({cacheDir:`${run}/vite-cache`, server:{host:'127.0.0.1',port:0,hmr:false,watch:null,fs:{allow:[process.cwd(),await realpath('node_modules')]}},clearScreen:false});
let browser;
const errors=[];
const settled=async page=>{await page.waitForFunction(()=>document.querySelector('#book-spread')?.getAttribute('aria-busy')==='false' && !!document.querySelector('#book-spread > .paper-page .page-prose p'));};
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('folio:demo')).bookPosition);
const same=(a,b)=>a.page===b.page&&a.offset===b.offset;
async function open(origin,reducedMotion='no-preference'){
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await settled(page);
 await page.keyboard.press('f');await page.waitForFunction(()=>document.body.classList.contains('focus-mode'));await settled(page);
 return page;
}
async function burst(page,keys,phase='immediate'){
 if(phase==='animation'){
   await page.evaluate(()=>document.querySelector('#next-page').click());
   await page.waitForSelector('.page-turn-layer');
   keys=keys.slice(1);
 }
 await page.evaluate(keys=>{for(const key of keys) document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));},keys);
 await page.waitForFunction(()=>!document.body.classList.contains('focus-mode'));await settled(page);
 assert.equal(await page.locator('.page-turn-layer').count(),0);
}
try{
 await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
 browser=await chromium.launch(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {channel:'chrome'});
 // Compare final anchors, not source page only: demo can have continuation spreads.
 for(const reduced of ['no-preference','reduce']){
  for(const [name,keys,phase] of [
   ['immediate next',['ArrowRight','Escape'],'immediate'],
   ['during animation',['ArrowRight','Escape'],'animation'],
   ['double escape',['ArrowRight','Escape','Escape'],'immediate'],
   ['queued next',['ArrowRight','ArrowRight','Escape'],'immediate'],
   ['queued reverse',['ArrowRight','ArrowLeft','Escape'],'immediate'],
  ]){
   if(reduced==='reduce'&&phase==='animation')continue;
   const expected=await open(origin,reduced), actual=await open(origin,reduced);
   const nav=keys.filter(k=>k!=='Escape');
   for(const key of nav){await expected.keyboard.press(key);await settled(expected);}
   await expected.keyboard.press('Escape');await expected.waitForFunction(()=>!document.body.classList.contains('focus-mode'));await settled(expected);
   const target=await saved(expected);
   await burst(actual,keys,phase);
   assert.ok(same(await saved(actual),target),`${name}/${reduced}: expected ${JSON.stringify(target)}, got ${JSON.stringify(await saved(actual))}`);
   await actual.reload();await settled(actual);assert.ok(same(await saved(actual),target),`${name}: reload preserves target`);
   console.log(`PASS ${name} (${reduced})`);await expected.close();await actual.close();
  }
 }
 const page=await open(origin);
 await page.evaluate(()=>document.querySelector('#next-page').click());await page.waitForSelector('.page-turn-layer');
 await page.evaluate(()=>{const input=document.querySelector('#page-input');input.value='5';document.querySelector('#page-form').dispatchEvent(new Event('submit',{cancelable:true}));});
 await settled(page);assert.equal((await saved(page)).page,5);assert.equal(await page.locator('.page-turn-layer').count(),0);
 console.log('PASS direct jump still cancels stale turn');
 await page.screenshot({path:`${run}/settled.png`});
 assert.deepEqual(errors,[]);console.log(`PASS all focus navigation checks; evidence ${run}`);
}finally{await browser?.close();await server.close();}
