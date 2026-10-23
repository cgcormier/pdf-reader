/** Browser-native tests: open /tests/layout-check.html on an isolated Vite origin. */
import { makeLayoutPdf, layoutPages } from './pdf-layout-fixture.mjs';
import { putBook, updateBook, getBook, savePreference } from '../src/storage.js';
import { STRUCTURE_VERSION, analyzeDocumentStructure } from '../src/document-structure.js';
import { openPdf } from '../src/pdf-engine.js';
import { offsetForSource } from '../src/pdf-layout.js';

const result = document.querySelector('#result');
const frame = document.querySelector('iframe');
const id = 'layout-browser-regression';
const lines = [];
const log = message => { lines.push(message); result.textContent = lines.join('\n'); };
const assert = (value, message) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const until = async (predicate, message) => {
  const deadline = performance.now() + 15000;
  while (!await predicate()) { if (performance.now() > deadline) throw new Error(`Timed out: ${message}`); await pause(); }
};
const doc = () => frame.contentDocument;
const click = async selector => { doc().querySelector(selector).click(); await pause(); };
const settled = () => until(() => doc()?.querySelector('#book-spread')?.getAttribute('aria-busy') !== 'true'
  && doc()?.querySelector('.layout-block'), 'reader layout');
const jump = async page => {
  const input = doc().querySelector('#page-input'); input.value = String(page);
  doc().querySelector('#page-form').dispatchEvent(new frame.contentWindow.Event('submit', { bubbles: true, cancelable: true }));
  await pause(); await settled();
};
const bounds = selector => {
  for (const node of doc().querySelectorAll(selector)) {
    assert(node.scrollWidth <= node.clientWidth + 1, `${selector}: horizontal overflow`);
    if (!doc().body.classList.contains('scroll-mode')) {
      assert(node.scrollHeight <= node.clientHeight + 1, `${selector}: clipped vertical text`);
      const box = node.getBoundingClientRect();
      assert(!node.lastElementChild || node.lastElementChild.getBoundingClientRect().bottom <= box.bottom + 1, `${selector}: last block clipped`);
    }
  }
};
const changeSize = async size => {
  const control = doc().querySelector('#appearance-button');
  control.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  for (let i = 6; i < size; i++) control.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await settled();
};
const reload = async () => {
  const previous = doc(); frame.contentWindow.location.reload();
  await until(() => doc() !== previous && doc()?.querySelector('#book-title')?.textContent === 'Layout corpus', 'fixture reload');
  await settled();
};
const sourceVisible = position => {
  const page = doc().querySelector(`.scroll-page[data-source-page="${position.page}"]`);
  const offset = offsetForSource(page.layoutModel.projection, position.source);
  const node = [...page.querySelectorAll('[data-layout-start]')].find(n => Number(n.dataset.layoutStart) <= offset && Number(n.dataset.layoutEnd) > offset);
  assert(node, 'restored source block missing');
  const walker = doc().createTreeWalker(node, frame.contentWindow.NodeFilter.SHOW_TEXT); let remaining = offset - Number(node.dataset.layoutStart); let textNode;
  while ((textNode = walker.nextNode())) { if (remaining < textNode.length) break; remaining -= textNode.length; }
  const range = doc().createRange(); range.setStart(textNode, remaining); range.setEnd(textNode, Math.min(textNode.length, remaining + 1));
  const box = range.getBoundingClientRect(); const stage = doc().querySelector('#scroll-stage').getBoundingClientRect();
  assert(box.top >= stage.top - 32 && box.top < stage.bottom, 'restored source is outside reading viewport');
};

document.querySelector('#run').addEventListener('click', async () => {
  lines.length = 0;
  try {
    assert(location.port !== '4173', 'Use an isolated origin, never the normal shelf');
    const bytes = makeLayoutPdf(layoutPages).buffer;
    const pdf = await openPdf(bytes); const structure = await analyzeDocumentStructure(pdf); await pdf.loadingTask.destroy();
    const scene = structure.nodes.find(n => n.title === 'Scene I'); const act = structure.nodes.find(n => n.title === 'Act I');
    const metadata = { page: 1, bookmarks: [2], bookPosition: { page: 1, offset: 40 },
      structure: { ...structure, version: STRUCTURE_VERSION - 1 },
      contentsExpanded: { [act.id]: true } };
    await putBook({ id, title: 'Layout corpus', filename: 'original-layout.pdf', bytes, addedAt: Date.now(), chapters: [{ title: 'Opening pages', page: 1 }], ...metadata });
    await updateBook(id, metadata);
    savePreference('active-book', id); savePreference('reading-layout', 'pages'); savePreference('appearance', { size: 17, paper: 'light' });
    frame.src = '/'; await until(() => doc()?.querySelector('#book-title')?.textContent === 'Layout corpus', 'fixture load'); await settled();
    await until(() => /4 of 4/.test(doc().querySelector('#structure-status')?.textContent ?? doc().body.textContent), 'structure upgrade');
    await until(async () => (await getBook(id)).structure.version === STRUCTURE_VERSION && (await getBook(id)).structure.status === 'complete', 'saved structure upgrade');
    assert((await getBook(id)).structure.version === STRUCTURE_VERSION, 'structure snapshot did not upgrade');
    assert((await getBook(id)).bookmarks.includes(2), 'bookmark lost');
    assert(!doc().querySelector('#edit-chapters'), 'retired Contents editor remains');
    assert(!doc().querySelector('#structure-tools').textContent.includes('Review'), 'retired suggestion editor remains');
    assert((await getBook(id)).contentsExpanded[act.id], 'expanded state lost');
    log('PASS automatic snapshot upgrade, bookmark, expanded state; editing controls absent');
    const saved = await getBook(id); assert(saved.bookPosition.layoutVersion === 1 && saved.bookPosition.legacyOffset === 40, 'legacy offset not migrated');
    log('PASS legacy offset migrated through source map');
    await click(`[data-node-id="${scene.id}"]`); await settled();
    assert(doc().querySelector('#current-chapter').textContent === 'Scene I', 'same-page selection lost');
    assert((await getBook(id)).bookPosition.offset > 0, 'same-page source anchor missing');
    log('PASS exact same-page automatic Contents jump');

    for (const width of [1100, 390]) {
      frame.width = width; await pause();
      for (const size of [10, 17, 23]) {
        await changeSize(size); await jump(1);
        for (let turn = 0; turn < 4; turn++) {
          bounds('#book-spread .page-prose');
          if (!doc().querySelector('#next-page').disabled) { await click('#next-page'); await until(() => !doc().querySelector('.page-turn-layer'), 'page turn'); await settled(); }
        }
        log(`PASS ${width}px pages at ${size}px: fit bounds and turns`);
      }
      await jump(3); await click('#scroll-layout');
      await until(() => doc().querySelector('.scroll-page[data-source-page="3"] .layout-speech'), 'scroll play');
      bounds('.scroll-page .page-prose');
      const play = doc().querySelector('.scroll-page[data-source-page="3"] .page-prose');
      assert(play.textContent.includes('25 miles') && !play.textContent.includes('FTLN'), 'speech/counter separation');
      assert(play.querySelector('.layout-stage-direction'), 'stage direction missing');
      const range = doc().createRange(); range.selectNodeContents(play);
      const selection = frame.contentWindow.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      assert(selection.toString().indexOf('TRAVELLER') < selection.toString().indexOf('MESSENGER'), 'selection order'); selection.removeAllRanges();
      await click('.scroll-page[data-source-page="3"] .layout-source-notes');
      assert(doc().querySelector('#modal-body').textContent.includes('FTLN 0001'), 'notes inaccessible'); await click('#modal-close');
      log(`PASS ${width}px scroll: speech, source lines, stage directions, selection, notes`);
      const page1 = doc().querySelector('.scroll-page[data-source-page="1"] .page-prose');
      assert(page1.textContent.includes('My goal') && (page1.textContent.match(/My goal/g) ?? []).length === 1, 'drop cap correction');
      await click('#original-view'); await until(() => doc().querySelector('.scroll-page canvas'), 'Original canvas');
      bounds('.scroll-canvas-host'); await click('#book-view'); await until(() => doc().querySelector('.layout-block'), 'pretty restore');
      await click('#pages-layout'); await settled();
      log(`PASS ${width}px Original canvas and return to both pretty modes`);
    }
    await jump(4); await changeSize(23); await click('#next-page'); await until(() => !doc().querySelector('.page-turn-layer'), 'long-page turn'); await settled();
    const before = (await getBook(id)).bookPosition; await reload();
    const after = (await getBook(id)).bookPosition;
    assert(before.page === after.page && before.offset === after.offset, 'reload moved source anchor');
    log('PASS long line pagination and reload source anchor');
    await click('#scroll-layout'); await until(() => doc().querySelector('.scroll-page[data-source-page="4"] .layout-block'), 'long scrolling page');
    await new Promise(resolve => setTimeout(resolve, 800));
    const sourcePlace = (await getBook(id)).bookPosition;
    const reflowStart = performance.now(); await changeSize(17); bounds('.scroll-page .page-prose');
    const reflowMs = performance.now() - reflowStart;
    assert(sourcePlace.source || before.source, 'source identity missing');
    sourceVisible(sourcePlace);
    await reload(); await until(() => doc().querySelector('.scroll-page[data-source-page="4"] .layout-block'), 'scroll reload'); await pause(); sourceVisible(sourcePlace);
    log(`PASS scroll source identity, size reflow (${Math.round(reflowMs)}ms including test waits) and reload`);
    await updateBook(id, { page: 2, bookPosition: { page: 2, offset: 0 }, scrollPosition: { page: 2, fraction: 0, view: 'book' } });
    await reload(); await until(() => doc().querySelector('.scroll-page[data-source-page="2"] .layout-block'), 'legacy zero scroll restore');
    await new Promise(resolve => setTimeout(resolve, 800));
    const zero = (await getBook(id)).bookPosition;
    assert(zero.layoutVersion === 1 && zero.legacyOffset === 0 && zero.offset > 0, 'legacy zero was reinterpreted as a new offset');
    sourceVisible(zero); log('PASS legacy zero after removed chapter title migrates in Scroll');
    log('ALL LAYOUT BROWSER CHECKS PASSED');
  } catch (error) { log(`FAIL ${error.stack}`); }
});
