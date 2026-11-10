/** Verify the real Book-view setting and its navigation contract in Chrome. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = 'output/playwright/page-turn-speed';
await mkdir(root, { recursive: true });
const run = await mkdtemp(`${root}/run-`);
const server = await createServer({ cacheDir: `${run}/vite-cache`,
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null,
    fs: { allow: [process.cwd(), await realpath('node_modules')] } }, clearScreen: false });
let browser;
const errors = [];
const browserLogs = [];
const speed = '#page-turn-speed-button';
const panel = '#page-turn-speed-panel';
const range = '#page-turn-speed-range';
const open = `${panel}:popover-open`;
const settled = page => page.locator('#book-spread[aria-busy="false"] > .paper-page .page-prose p').first().waitFor();
const position = page => page.locator('#page-input').inputValue();
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('folio:demo')));
const animations = (page, target) => page.evaluate(target => window.speedAnimations.filter(animation => animation.target === target), target);
const value = page => page.locator(range).inputValue();
const expectValue = (page, ms) => page.waitForFunction(ms => document.getElementById('page-turn-speed-range').valueAsNumber === ms, ms);
async function watch(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserLogs.push(message.text()); });
  await page.addInitScript(() => {
    window.speedAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      for (const target of ['page-turn-speed-panel', 'speed-tape', 'speed-leaf', 'page-turn-leaf']) {
        if (this.classList.contains(target)) window.speedAnimations.push({ target, duration: options.duration });
      }
      return animate.call(this, keyframes, options);
    };
  });
}
async function checkFit(page) {
  const result = await page.locator(open).evaluate(async node => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(node.getAnimations().map(animation => animation.finished));
    const rect = node.getBoundingClientRect();
    const client = document.documentElement.clientWidth;
    const close = node.querySelector('.speed-close').getBoundingClientRect();
    return { left: rect.left, right: client - rect.right, top: rect.top, bottom: innerHeight - rect.bottom,
      close: close.width, horizontal: node.scrollWidth - node.clientWidth, documentOverflow: document.documentElement.scrollWidth - client };
  });
  for (const side of ['left', 'right', 'top', 'bottom']) assert.ok(result[side] >= 11.5, `${side} panel gutter: ${JSON.stringify(result)}`);
  assert.equal(result.close, 36);
  assert.equal(result.horizontal, 0);
  assert.equal(result.documentOverflow, 0);
}

try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await watch(page);
  await page.goto(origin);
  await settled(page);
  assert.equal(await value(page), '350');
  await page.locator('#next-page').click();
  await settled(page);
  assert.deepEqual(await animations(page, 'page-turn-leaf'), [{ target: 'page-turn-leaf', duration: 350 }]);
  await page.locator('#previous-page').click();
  await settled(page);
  await page.evaluate(() => { window.speedAnimations = []; });
  await page.locator(speed).hover();
  await page.locator(open).waitFor();
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'page-turn-speed-range', 'hover took keyboard focus');
  await page.waitForFunction(() => window.speedAnimations.some(animation => animation.target === 'page-turn-speed-panel'));
  await page.locator(`${panel} h2`).hover();
  await page.waitForTimeout(240);
  assert.equal(await page.locator(open).count(), 1, 'crossing the trigger gap dismissed the panel');
  await checkFit(page);
  await page.screenshot({ path: `${run}/desktop-hover.png`, animations: 'disabled' });
  await page.mouse.move(10, 10);
  await page.locator(open).waitFor({ state: 'hidden' });

  // Enter opens the same range for native arrows, Home and End.
  await page.locator(speed).press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'page-turn-speed-range');
  await page.keyboard.press('ArrowRight');
  await expectValue(page, 375);
  await page.keyboard.press('Home');
  await expectValue(page, 0);
  assert.equal(await page.locator(range).getAttribute('aria-valuetext'), 'Instant');
  assert.equal(await page.locator(`${panel} output`).textContent(), 'Instant');
  await page.keyboard.press('End');
  await expectValue(page, 500);

  // The event bubbles unconsumed outside the ruler, at a limit or for zoom.
  const wheel = (selector, options) => page.locator(selector).evaluate((node, options) => node.dispatchEvent(
    new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options })), options);
  assert.equal(await wheel(range, { deltaY: 110 }), true);
  assert.equal(await wheel(range, { deltaY: -110, ctrlKey: true }), true);
  assert.equal(await wheel(`${panel} h2`, { deltaY: -110 }), true);
  await expectValue(page, 500);
  assert.equal(await wheel(range, { deltaX: -9 }), false);
  assert.equal(await wheel(range, { deltaX: -10 }), false);
  await expectValue(page, 500);
  assert.equal(await wheel(range, { deltaX: -10 }), false);
  await expectValue(page, 475);
  const ruler = await page.locator(range).boundingBox();
  await page.mouse.move(ruler.x + 120, ruler.y + 22);
  await page.mouse.wheel(0, 90);
  await expectValue(page, 500);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 156, ruler.y + 22, { steps: 4 });
  await page.mouse.up();
  await expectValue(page, 450);

  // The preview runs at the selected speed and does not save a reading place.
  const initialPosition = await position(page);
  const beforePreview = await saved(page);
  await page.locator(`${panel} .speed-replay`).click();
  assert.deepEqual(await animations(page, 'speed-leaf'), [{ target: 'speed-leaf', duration: 450 }]);
  assert.equal(await position(page), initialPosition);
  assert.deepEqual(await saved(page), beforePreview);
  await page.keyboard.press('Escape');
  await page.locator(open).waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'page-turn-speed-button');
  await page.locator(speed).click();
  await page.locator('#current-chapter').click();
  await page.locator(open).waitFor({ state: 'hidden' });

  // The next turn snapshots its value before any destination preparation.
  await page.evaluate(() => {
    window.__folioReaderMetric = event => {
      if (event.type !== 'turn-start') return;
      delete window.__folioReaderMetric;
      const input = document.getElementById('page-turn-speed-range');
      input.valueAsNumber = 500;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
  });
  await page.locator('#next-page').click();
  await settled(page);
  assert.notEqual(await position(page), initialPosition);
  assert.deepEqual(await animations(page, 'page-turn-leaf'), [{ target: 'page-turn-leaf', duration: 450 }]);
  const afterFirstTurn = await position(page);
  assert.equal((await saved(page)).page, Number(afterFirstTurn));
  await page.reload();
  await settled(page);
  await expectValue(page, 500);
  assert.equal(await position(page), afterFirstTurn);
  await page.locator('#previous-page').click();
  await settled(page);
  assert.equal(await position(page), initialPosition);
  assert.deepEqual(await animations(page, 'page-turn-leaf'), [{ target: 'page-turn-leaf', duration: 500 }]);

  await page.locator(speed).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await page.locator('#next-page').click();
  await settled(page);
  assert.notEqual(await position(page), initialPosition);
  assert.equal((await animations(page, 'page-turn-leaf')).length, 1, 'Instant created a reading animation');
  await page.locator(speed).click();
  await page.keyboard.press('End');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.speed-note').textContent.includes('Reduced motion'));
  await page.locator(`${panel} .speed-replay`).click();
  assert.equal((await animations(page, 'speed-leaf')).length, 0, 'reduced-motion sample animated');
  await page.keyboard.press('Escape');
  await page.locator('#previous-page').click();
  await settled(page);
  assert.equal(await position(page), initialPosition);
  assert.equal((await animations(page, 'page-turn-leaf')).length, 1, 'reduced-motion turn animated');
  await expectValue(page, 500);

  await page.locator('#focus-button').click();
  await settled(page);
  for (const control of [range, `${panel} .speed-close`, `${panel} .speed-replay`]) {
    await page.locator(speed).click();
    await page.locator(control).focus();
    await page.keyboard.press('Escape');
    await page.locator(open).waitFor({ state: 'hidden' });
    assert.equal(await page.locator('body.focus-mode').count(), 1, 'Escape from speed controls exited Focus mode');
  }
  await page.locator('#focus-button').click();
  await page.locator(speed).click();
  await page.locator('#scroll-layout').click();
  assert.equal(await page.locator(speed).isVisible(), false);
  await page.locator(open).waitFor({ state: 'hidden' });
  await page.locator('#pages-layout').click();
  await settled(page);
  await page.locator('#file-input').setInputFiles('public/sample.pdf');
  await page.locator('#original-view:enabled').waitFor();
  await page.locator('#original-view').click();
  await page.locator('#original-stage canvas').waitFor();
  assert.equal(await page.locator(speed).isVisible(), false, 'speed shown in Original PDF');

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await watch(phone);
  await phone.goto(origin);
  await settled(phone);
  await phone.locator(speed).tap();
  await phone.locator(open).waitFor();
  await checkFit(phone);
  await phone.screenshot({ path: `${run}/phone-390.png`, animations: 'disabled' });

  // Real touch input moves the ruler without paging or scrolling the reader.
  const session = await phone.context().newCDPSession(phone);
  const track = await phone.locator(range).boundingBox();
  const point = { x: track.x + 120, y: track.y + 24 };
  const phonePosition = await position(phone);
  const phoneScroll = await phone.evaluate(() => scrollY);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (const offset of [12, 24, 36]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x - offset, y: point.y }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expectValue(phone, 400);
  assert.equal(await position(phone), phonePosition);
  assert.equal(await phone.evaluate(() => scrollY), phoneScroll);

  for (const [width, height] of [[320, 760], [501, 760], [540, 760], [640, 320]]) {
    await phone.setViewportSize({ width, height });
    await checkFit(phone);
    await phone.screenshot({ path: `${run}/viewport-${width}x${height}.png`, animations: 'disabled' });
  }
  assert.equal(await phone.locator(open).evaluate(node => node.scrollHeight > node.clientHeight), true, 'short panel cannot scroll');
  await phone.locator(`${panel} .speed-replay`).tap();
  assert.equal((await animations(phone, 'speed-leaf')).at(-1)?.duration, 400, 'short panel preview is unreachable');
  assert.deepEqual(errors, []);
  console.log(`PASS page turn speed browser checks. Screenshots: ${run}`);
} catch (error) {
  await browser?.contexts().at(-1)?.pages()[0]?.screenshot({ path: `${run}/failure.png` }).catch(() => {});
  console.error(`Page turn speed browser evidence: ${run}`, { errors, browserLogs });
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
