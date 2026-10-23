/** Browser-native performance and regression checks, served by Vite on a test origin. */
import { makeLayoutPdf } from './pdf-layout-fixture.mjs';
import { putBook, updateBook, getBook, savePreference } from '../src/storage.js';
import { STRUCTURE_VERSION } from '../src/document-structure.js';
const baseline = new URLSearchParams(location.search).has('baseline');
const readerPath = baseline ? '/output/playwright/page-flip-baseline/' : '/';
const { paginateText } = await import(`${readerPath}src/book-pagination.js`);

const frame = document.querySelector('iframe');
const result = document.querySelector('#result');
const pause = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (predicate, label) => {
  const deadline = performance.now() + 15000;
  while (!await predicate()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await pause();
  }
};
const doc = () => frame.contentDocument;
const settled = () => until(() => doc()?.querySelector('#book-spread')?.getAttribute('aria-busy') === 'false'
  && doc()?.querySelector('#book-spread > .paper-page'), 'spread');
const click = selector => doc().querySelector(selector).click();
const anchor = () => [...doc().querySelectorAll('#book-spread > .paper-page')].map(p => [p.dataset.sourcePage, p.dataset.textOffset]);
const fits = () => {
  for (const prose of doc().querySelectorAll('#book-spread > .paper-page .page-prose')) {
    assert(prose.scrollHeight <= prose.clientHeight + 1, 'page text overflows vertically');
    assert(prose.scrollWidth <= prose.clientWidth + 1, 'page text overflows horizontally');
  }
};
const jump = async number => {
  doc().querySelector('#page-input').value = String(number);
  doc().querySelector('#page-form').dispatchEvent(new frame.contentWindow.Event('submit', { cancelable: true }));
  await settled();
};
const id = 'page-flip-regression';

document.querySelector('#run').addEventListener('click', async () => {
  const logs = []; const log = value => { logs.push(value); result.textContent = logs.join('\n'); };
  window.flipResults = null;
  try {
    assert(location.port !== '4173', 'Use an isolated origin');
    let probes = 0; let measuredCharacters = 0;
    const text = 'word '.repeat(20000);
    const fragments = paginateText(text, slice => { probes++; measuredCharacters += slice.length; return slice.length <= 500; });
    assert(fragments.map(f => f.text).join('') === text, 'pagination loses source characters');
    const metrics = { probes, measuredCharacters, fragments: fragments.length, turns: [] };
    log(`Pagination: ${JSON.stringify({ probes, measuredCharacters, fragments: fragments.length })}`);

    const pages = Array.from({ length: 8 }, (_, p) => ({ items: Array.from({ length: 36 }, (_, line) => ({
      text: `Page ${p + 1}, line ${line + 1}. Original prose for measuring a lossless page turn.`,
      x: 40, y: 740 - line * 18, size: 10,
    })) }));
    const bytes = makeLayoutPdf(pages).buffer;
    const metadata = { page: 1, bookmarks: [2], chapters: [{ title: 'Opening', page: 1 }],
      bookPosition: { page: 1, offset: 0, layoutVersion: 1 }, contentsExpanded: {},
      structure: { version: STRUCTURE_VERSION, status: 'complete', totalPages: 8,
        nodes: [{ id: 'opening', parentId: null, kind: 'chapter', title: 'Opening', page: 1, source: 'outline' }],
        scannedPages: [1,2,3,4,5,6,7,8], failedPages: [], textPages: 8 } };
    await putBook({ id, title: 'Flip corpus', filename: 'flip-corpus.pdf', bytes, addedAt: Date.now(), ...metadata });
    await updateBook(id, metadata);
    savePreference('active-book', id); savePreference('reading-layout', 'pages'); savePreference('appearance', { size: 17, paper: 'light' });
    frame.src = readerPath;
    await until(() => doc()?.querySelector('#book-title')?.textContent === 'Flip corpus', 'book load');
    await settled();

    let clonedPages = 0;
    const proto = frame.contentWindow.Element.prototype;
    const clone = frame.contentWindow.Node.prototype.cloneNode;
    frame.contentWindow.Node.prototype.cloneNode = function (...args) {
      if (this.classList?.contains('paper-page')) clonedPages++;
      return clone.apply(this, args);
    };
    const height = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
    let fitReads = 0;
    Object.defineProperty(proto, 'scrollHeight', { ...height, get() {
      if (this.classList.contains('page-prose') && this.closest('.book-measure')) fitReads++;
      return height.get.call(this);
    } });
    const turn = async direction => {
      const before = anchor(); const stage = doc().querySelector('#book-spread');
      const started = performance.now(); let animationStarted = null; let maximumPages = 0;
      const watch = new MutationObserver(() => {
        if (stage.querySelector('.page-turn-layer') && animationStarted === null) animationStarted = performance.now();
        maximumPages = Math.max(maximumPages, stage.querySelectorAll('.paper-page').length);
      });
      watch.observe(stage, { childList: true, subtree: true });
      const oldClones = clonedPages; const oldReads = fitReads;
      click(direction === 'next' ? '#next-page' : '#previous-page');
      await settled(); watch.disconnect(); fits();
      assert(JSON.stringify(anchor()) !== JSON.stringify(before), 'turn did not advance');
      return { prepareMs: Math.round((animationStarted ?? started) - started), totalMs: Math.round(performance.now() - started),
        clonedPages: clonedPages - oldClones, fitReads: fitReads - oldReads, maximumPages };
    };
    let previousPages;
    for (let i = 0; i < 6; i++) {
      await pause(350);
      previousPages = [...doc().querySelectorAll('#book-spread > .paper-page')];
      metrics.turns.push(await turn('next'));
    }
    metrics.reverse = await turn('previous');
    if (!baseline) {
      assert([...doc().querySelectorAll('#book-spread > .paper-page')].every((page, index) => page === previousPages[index]), 'reverse rebuilt the preceding spread');
      assert(metrics.turns.every(turn => turn.clonedPages === 0), 'animated turns deep-copied pages');
    }
    log(`Turns: ${JSON.stringify(metrics.turns)}`); log(`Reverse: ${JSON.stringify(metrics.reverse)}`);
    const beforeCancel = anchor();
    click('#next-page');
    await until(() => doc().querySelector('.page-turn-layer'), 'animation to cancel');
    click('#scroll-layout');
    assert(!doc().querySelector('.page-turn-layer'), 'cancel left a turn overlay');
    click('#pages-layout'); await settled();
    assert(JSON.stringify(anchor()) === JSON.stringify(beforeCancel), 'cancel committed the destination');
    log('PASS forward/reverse, fitting leaves, cancellation');

    await jump(2); click('#next-page');
    await until(() => doc().querySelector('.page-turn-layer'), 'turn before direct jump');
    await jump(5);
    assert(anchor()[0][0] === '5' && !doc().querySelector('.page-turn-layer'), 'direct jump was overwritten by a stale turn');
    log('PASS direct jump cancels a turn');

    click('#next-page'); await until(() => doc().querySelector('.page-turn-layer'), 'turn before resize');
    frame.width = '390'; await pause(350); await settled();
    assert(!doc().querySelector('.page-turn-layer'), 'resize retained an old overlay');
    await jump(1); await pause(350); await turn('next');
    const saved = (await getBook(id)).bookPosition;
    assert(saved.offset > 0, 'phone did not reach a continuation');
    const oldDocument = doc(); frame.contentWindow.location.reload();
    await until(() => doc() !== oldDocument && doc()?.querySelector('#book-title')?.textContent === 'Flip corpus', 'reload');
    await settled();
    const restored = (await getBook(id)).bookPosition;
    assert(saved.page === restored.page && saved.offset === restored.offset, 'reload lost source anchor');
    fits();
    const control = doc().querySelector('#appearance-button');
    control.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settled(); fits();
    assert((await getBook(id)).bookPosition.offset === saved.offset, 'text size lost source anchor');
    log('PASS phone continuation, reload, typography invalidation');

    const idle = frame.contentWindow.requestIdleCallback;
    frame.contentWindow.requestIdleCallback = undefined;
    await jump(2); await pause(350); await turn('next');
    frame.contentWindow.requestIdleCallback = idle;
    log('PASS preparation without requestIdleCallback');
    click('#focus-button'); await settled(); fits();
    const media = frame.contentWindow.matchMedia;
    frame.contentWindow.matchMedia = function (query) {
      return query === '(prefers-reduced-motion: reduce)' ? { matches: true } : media.call(this, query);
    };
    await jump(8);
    for (let i = 0; i < 30 && !doc().querySelector('#next-page').disabled; i++) { click('#next-page'); await settled(); fits(); }
    assert(doc().querySelector('#next-page').disabled, 'EOF did not disable Next');
    assert(!doc().querySelector('.page-turn-layer'), 'reduced motion created an overlay');
    frame.contentWindow.matchMedia = media;
    const stored = await getBook(id);
    assert(stored.bookmarks.includes(2) && stored.structure.status === 'complete', 'position-only save lost metadata');
    click('#original-view'); await until(() => doc().querySelector('#original-stage canvas'), 'Original canvas');
    log('PASS focus, reduced motion, EOF, saved metadata and Original PDF');
    window.flipResults = metrics;
    log('ALL PAGE FLIP CHECKS PASSED');
  } catch (error) { log(`FAIL ${error.stack}`); }
});
