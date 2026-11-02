import assert from 'node:assert/strict';

// Check the visible destination, not a previous page or an empty paper shell.
export async function readerState(page, sourcePage) {
  return page.evaluate(expected => {
    const scroll = document.body.classList.contains('scroll-mode');
    const original = document.querySelector('#original-view').getAttribute('aria-pressed') === 'true';
    const stage = document.querySelector(scroll ? '#scroll-stage' : original ? '#original-stage' : '#book-spread');
    if (document.querySelector('#modal').open || stage.hidden || stage.getAttribute('aria-busy') === 'true'
      || scroll && stage.dataset.activeLoads !== '0') return null;
    const number = Number(document.querySelector('#page-input').value);
    if (expected !== undefined && number !== expected) return null;
    const visible = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
      && rect.right > 0 && rect.left < innerWidth;
    const selector = scroll ? `.scroll-page[data-source-page="${number}"]` : original ? 'canvas' : '.paper-page:not(.end-page)';
    const leaves = [...stage.querySelectorAll(selector)].filter(n => visible(n.getBoundingClientRect()));
    if (!leaves.length || !original && !leaves.some(n => Number(n.dataset.sourcePage) === number)) return null;
    const rects = [];
    const content = leaves.map((leaf, index) => {
      const prose = leaf.querySelector('.page-prose');
      const canvas = leaf.matches('canvas') ? leaf : leaf.querySelector('canvas');
      if (prose?.textContent.trim()) {
        if (!canvas && document.querySelector('#book-type').textContent === 'FROM YOUR SHELF' && !prose.querySelector('.layout-block')) return null;
        if (leaf.layoutModel?.projection.text.trim() && !prose.querySelector('.layout-block')) return null;
        const start = rects.length;
        const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          for (const r of range.getClientRects()) if (visible(r)) rects.push({ leaf:index, x:r.x, y:r.y, width:r.width, height:r.height });
        }
        if (rects.length === start) return null;
        return { page:leaf.dataset.sourcePage, start:leaf.dataset.textOffset, end:leaf.dataset.textEnd, text:prose.textContent };
      }
      if (canvas?.width && canvas.height) {
        const r = canvas.getBoundingClientRect();
        rects.push({ leaf:index, x:r.x, y:r.y, width:r.width, height:r.height });
        return { page:leaf.dataset.sourcePage ?? number, canvas:[canvas.width,canvas.height] };
      }
      return null;
    });
    if (content.some(n => !n) || !rects.length) return null;
    return { number, scroll, original, width:innerWidth, height:innerHeight, content, rects };
  }, sourcePage);
}

export async function settledReader(page, sourcePage) {
  await page.evaluate(() => document.fonts.ready);
  const deadline = Date.now() + 30000;
  let previous, stableSince;
  while (Date.now() < deadline) {
    const state = await readerState(page, sourcePage);
    const key = state && JSON.stringify(state);
    if (key && key === previous) {
      if (Date.now() - stableSince >= 200) return state;
    } else { previous = key; stableSince = Date.now(); }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Reader did not settle with visible content at source ${sourcePage ?? 'current page'}`);
}

export async function captureReader(page, file, sourcePage) {
  const before = await settledReader(page, sourcePage);
  // Full-page CDP captures can resize Electron and trigger repagination mid-shot.
  const png = await page.screenshot({ path: file, fullPage: false });
  const after = await readerState(page, before.number);
  assert.deepEqual(after, before, 'capture changed the settled destination or geometry');
  const ink = await page.evaluate(async ({ base64, rects }) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type:'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); context.drawImage(bitmap,0,0); bitmap.close();
    const scaleX = canvas.width / innerWidth, scaleY = canvas.height / innerHeight;
    const histograms = new Map();
    for (const r of rects) {
      if (!histograms.has(r.leaf)) histograms.set(r.leaf,new Array(256).fill(0));
      const tones = histograms.get(r.leaf);
      const x = Math.max(0,Math.floor(r.x*scaleX)), y = Math.max(0,Math.floor(r.y*scaleY));
      const w = Math.min(canvas.width-x,Math.ceil(r.width*scaleX)), h = Math.min(canvas.height-y,Math.ceil(r.height*scaleY));
      if (w <= 0 || h <= 0) continue;
      const data = context.getImageData(x,y,w,h).data;
      for (let i=0;i<data.length;i+=4) if (data[i+3]) tones[Math.round((data[i]+data[i+1]+data[i+2])/3)]++;
    }
    return Math.min(...[...histograms.values()].map(tones => {
    const low = tones.findIndex(n => n > 0), high = tones.findLastIndex(n => n > 0);
    const middle = Math.floor((low+high)/2);
    return high-low < 40 ? 0 : Math.min(tones.slice(0,middle+1).reduce((a,b)=>a+b,0),tones.slice(middle+1).reduce((a,b)=>a+b,0));
    }));
  }, { base64:png.toString('base64'), rects:before.rects });
  assert.ok(ink > 20, `capture has no readable ink in expected content bounds: ${file}`);
  return { sourcePage:before.number, leaves:before.content.map(({ text, ...leaf }) => ({ ...leaf, characters:text?.length })), ink };
}
