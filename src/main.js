import './styles.css';
import { openPdf, detectChapters, extractPage, renderPdfPage, titleFromFilename } from './pdf-engine.js';
import { demo } from './demo.js';
import { removeRepeatedChapterHeading, sourcePageNavigation, swipePageDirection } from './book-layout.js';
import { createPageScroller } from './page-scroll.js';
import { turnPages } from './page-turn.js';
import { paginateText, createBookPager } from './book-pagination.js';
import { preference, savePreference, getBook, putBook, updateBook, deleteBook, listBooks } from './storage.js';

const $ = id => document.getElementById(id);
const smallScreen = matchMedia('(max-width: 820px)');
let book = structuredClone(demo);
let pdf = null;
let mode = 'book';
let layout = preference('reading-layout', 'pages') === 'pages' ? 'pages' : 'scroll';
let scroller = null;
let pagedRenderController = null;
let turnController = null;
let pageFillPromise = Promise.resolve();
let fittedSpread = null;
const fragmentCache = new Map();
let resizeTimer;
let scrollSaveTimer = null;
let epoch = 0;
let importing = null;
let shelf = [];
let pageCache = new Map();
let toastTimer;
let installPrompt;
let saved = true;
let bookStored = true;
let modalCleanup = null;
let starting = true;
const appearance = preference('appearance', { size: 17, paper: 'light' });
const roman = n => ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][n - 1] || String(n);
const pageCount = () => pdf?.numPages || demo.pages.length;
const disposePdf = document => document?.loadingTask?.destroy();
const step = () => layout === 'scroll' || mode === 'original' || smallScreen.matches ? 1 : 2;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function showModal(title, content, cleanup = null) {
  cancelPageTurn();
  if ($('modal').open) $('modal').close();
  modalCleanup = cleanup;
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(content);
  $('modal').showModal();
}
$('modal-close').addEventListener('click', () => {
  const cleanup = modalCleanup;
  modalCleanup = null;
  cleanup?.();
  $('modal').close();
});
$('modal').addEventListener('cancel', () => {
  const cleanup = modalCleanup;
  modalCleanup = null;
  cleanup?.();
});
function actions(...buttons) {
  const row = el('div', 'modal-actions');
  row.append(...buttons);
  return row;
}
function button(text, className, action) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function applyAppearance() {
  document.documentElement.style.setProperty('--reading-size', `${Math.max(15, Math.min(23, appearance.size || 17))}px`);
  document.body.classList.toggle('dark-paper', appearance.paper === 'dark');
  document.documentElement.style.colorScheme = appearance.paper === 'dark' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = appearance.paper === 'dark' ? '#2c251e' : '#eee7d8';
  savePreference('appearance', appearance);
  scroller?.reflow();
  if (fittedSpread && mode === 'book' && layout === 'pages') render();
}
applyAppearance();
function currentChapter(page = book.page) {
  return book.chapters.filter(chapter => chapter.page <= page).at(-1) || book.chapters[0];
}
function closeContents() {
  document.body.classList.remove('contents-open');
  $('contents-toggle').setAttribute('aria-expanded', 'false');
}
$('contents-close').addEventListener('click', closeContents);
function updateContents() {
  const fragment = document.createDocumentFragment();
  book.chapters.forEach((chapter, i) => {
    const link = button('', 'chapter-link', () => { navigate(chapter.page); closeContents(); });
    link.dataset.page = chapter.page;
    link.classList.toggle('active', chapter === currentChapter());
    if (chapter === currentChapter()) link.setAttribute('aria-current', 'location');
    link.append(el('span', 'chapter-number', roman(i + 1)), el('span', 'chapter-label', chapter.title), el('span', 'chapter-page', chapter.page));
    fragment.append(link);
  });
  $('chapter-list').replaceChildren(fragment);
  $('book-title').textContent = book.title;
  $('book-author').textContent = book.author || `${pageCount()} pages · Your personal edition`;
  $('book-type').textContent = book.id === 'demo' ? 'A FOLIO ORIGINAL' : 'FROM YOUR SHELF';
  $('edit-chapters').disabled = book.id === 'demo';
  $('original-view').disabled = !pdf;
  $('chapter-note').textContent = ({ outline: 'Chapters from the PDF’s contents.', headings: `Headings detected in the first ${book.scannedPages} pages. You can edit them.`, fallback: `No chapter headings found in ${book.scannedPages} scanned pages. Add your own with Edit.`, manual: 'Your own chapter arrangement.', demo: 'A short read to make yourself at home.' })[book.source] || '';
  $('current-chapter').textContent = `CHAPTER ${roman(book.chapters.indexOf(currentChapter()) + 1)} · ${currentChapter().title}`;
  $('current-chapter').title = currentChapter().title;
  $('read-time').textContent = book.id === 'demo' ? 'TAKE YOUR TIME' : `${pageCount()} PAGES, AT YOUR PACE`;
  document.title = `${book.title} — Folio`;
}
function updateControls() {
  const count = pageCount();
  const navigation = sourcePageNavigation(book.page, count, step());
  const fitted = mode === 'book' && layout === 'pages' ? fittedSpread : null;
  const end = fitted?.leaves.at(-1)?.page || navigation.end;
  const continued = fitted?.anchor.offset > 0;
  if (document.activeElement !== $('page-input')) $('page-input').value = book.page;
  $('page-input').max = count;
  $('total-pages').textContent = `${end > book.page ? `– ${end} ` : ''}of ${count}${continued ? ' · continued' : ''}`;
  $('page-input').setAttribute('aria-label', 'PDF page number');
  $('progress-slider').max = count;
  $('progress-slider').value = book.page;
  $('progress-slider').setAttribute('aria-valuetext', end > book.page ? `PDF pages ${book.page} to ${end} of ${count}` : `PDF page ${book.page}${continued ? ', continued' : ''} of ${count}`);
  const atEnd = fitted ? fitted.next === null : navigation.end === count;
  const sourceLength = fragmentCache.get(book.page)?.at(-1)?.end || 1;
  const fraction = fitted ? Math.min(1, (book.bookPosition?.offset || 0) / sourceLength) : 0;
  const percent = atEnd ? 100 : fitted ? Math.floor((book.page - 1 + fraction) / count * 100) : Math.round((book.page - 1) / Math.max(1, count - 1) * 100);
  $('progress-percent').textContent = `${percent}%`;
  $('progress-slider').style.setProperty('--progress', `${percent}%`);
  $('progress-text').textContent = percent === 0 ? 'The beginning of something good.' : percent === 100 ? 'A good place to pause.' : 'One page at a time.';
  $('previous-page').disabled = turnController !== null || (mode === 'book' && layout === 'pages' ? !fitted || (fitted.anchor.page === 1 && fitted.anchor.offset === 0) : navigation.previous === null);
  $('previous-page').setAttribute('aria-label', step() === 2 ? 'Previous two pages' : 'Previous page');
  $('next-page').setAttribute('aria-label', step() === 2 ? 'Next two pages' : 'Next page');
  $('next-page').disabled = turnController !== null || (mode === 'book' && layout === 'pages' ? !fitted || fitted.next === null : navigation.next === null);
  const bookmarked = book.bookmarks.includes(book.page);
  $('bookmark-button').classList.toggle('is-bookmarked', bookmarked);
  $('bookmark-button').setAttribute('aria-pressed', String(bookmarked));
  $('bookmark-button').setAttribute('aria-label', bookmarked ? 'Remove this bookmark' : 'Bookmark this page');
  $('bookmark-button').title = bookmarked ? `Remove bookmark on page ${book.page}` : `Bookmark page ${book.page}`;
  $('book-view').classList.toggle('active', mode === 'book');
  $('original-view').classList.toggle('active', mode === 'original');
  $('book-view').setAttribute('aria-pressed', String(mode === 'book'));
  $('original-view').setAttribute('aria-pressed', String(mode === 'original'));
  ['pages', 'scroll'].forEach(value => {
    $(`${value}-layout`).classList.toggle('active', layout === value);
    $(`${value}-layout`).setAttribute('aria-pressed', String(layout === value));
  });
  $('pages-layout').textContent = mode === 'book' ? 'Page flip' : 'Pages';
  $('pages-layout').title = mode === 'book' ? 'Smooth book page turns (S)' : 'One original PDF page at a time (S)';
  const flipHint = smallScreen.matches ? 'Swipe or ← → to flip · S to scroll' : '← → to flip · S to scroll';
  $('navigation-hint').textContent = layout === 'scroll' ? 'Scroll at your own pace · S to flip' : mode === 'book' ? flipHint : '← → for pages · S to scroll';
  $('save-status').textContent = saved ? 'Your place is kept, automatically.' : 'Reading now. Local saving is unavailable.';
}
async function persist() {
  const id = book.id;
  const metadata = structuredClone({ page: book.page, bookmarks: book.bookmarks, chapters: book.chapters, source: book.source, scrollPosition: book.scrollPosition, bookPosition: book.bookPosition });
  savePreference('active-book', id);
  if (id === 'demo') {
    saved = savePreference('demo', metadata);
  } else {
    try {
      if (!bookStored) throw new Error('Book is not saved.');
      await updateBook(id, metadata);
      if (book.id === id) saved = true;
    } catch { if (book.id === id) saved = false; }
  }
  if (book.id === id) updateControls();
}
function flushScrollSave() {
  if (scrollSaveTimer === null) return;
  clearTimeout(scrollSaveTimer); scrollSaveTimer = null;
  persist();
}
function scheduleScrollSave() {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => { scrollSaveTimer = null; persist(); }, 650);
}
function updateReadingPosition() {
  const chapter = currentChapter();
  [...$('chapter-list').children].forEach(link => {
    const active = Number(link.dataset.page) === chapter.page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  $('current-chapter').textContent = `CHAPTER ${roman(book.chapters.indexOf(chapter) + 1)} · ${chapter.title}`;
  $('current-chapter').title = chapter.title;
  updateControls();
}
function stopReadingRender() {
  cancelPageTurn();
  scroller?.destroy(); scroller = null;
  pagedRenderController?.abort(); pagedRenderController = null;
}
function cancelPageTurn() {
  if (!turnController) return;
  turnController.abort();
  turnController = null;
  $('book-spread').setAttribute('aria-busy', 'false');
  updateControls();
}
async function pageText(number, source = pdf) {
  if (!source) return { paragraphs: demo.pages[number - 1], hasText: true };
  if (!pageCache.has(number)) {
    if (pageCache.size >= 6) pageCache.delete(pageCache.keys().next().value);
    const pending = extractPage(source, number);
    pageCache.set(number, pending);
    pending.catch(() => { if (pageCache.get(number) === pending) pageCache.delete(number); });
  }
  return pageCache.get(number);
}
function paperPage(number, side, offset = 0) {
  const page = el('article', side === 'scroll' ? 'paper-page scroll-page' : `paper-page ${side}-page`);
  page.dataset.sourcePage = number;
  page.setAttribute('aria-label', number <= pageCount() ? `Page ${number}` : 'End of book');
  if (number > pageCount()) {
    page.classList.add('end-page');
    page.append(el('span', 'end-mark', 'Fin.'), el('p', 'small-label', 'UNTIL NEXT TIME'));
    return page;
  }
  const chapter = currentChapter(number);
  const running = el('div', 'page-running-header');
  running.append(el('span', '', book.title), el('span', '', 'FOLIO'));
  page.append(running);
  const prose = el('div', 'page-prose');
  if (chapter.page === number && offset === 0) {
    const title = el('div', 'chapter-intro');
    const heading = el('h2', 'chapter-title', chapter.title);
    heading.title = chapter.title;
    title.append(el('div', 'chapter-kicker', `CHAPTER ${roman(book.chapters.indexOf(chapter) + 1)}`), heading, el('div', 'chapter-ornament', '✦'));
    prose.append(title);
  }
  page.dataset.textOffset = offset;
  page.setAttribute('aria-label', `PDF page ${number}${offset ? ', continued' : ''}`);
  page.append(prose, el('div', 'page-number', `${number}${offset ? ' · continued' : ''}`));
  return page;
}
async function fillPaperPage(number, page, { signal, renderEpoch, source }) {
  const prose = page.querySelector('.page-prose');
  page.classList.add('is-loading');
  try {
    const data = await pageText(number, source);
    if (signal.aborted || renderEpoch !== epoch) return;
    if (!data.hasText) {
      const notice = el('div', 'scanned-message');
      notice.append(el('p', '', 'This page is better seen in its original form.'), el('p', 'inline-note', 'It may be a scan, illustration, or a page without readable text.'), button('View original page ↗', 'secondary-button', () => { flushScrollSave(); book.page = number; book.scrollPosition = { page: number, fraction: 0, view: 'original' }; mode = 'original'; render(); persist(); }));
      prose.append(notice);
    } else {
      const chapter = currentChapter(number);
      const paragraphs = source && chapter.page === number ? removeRepeatedChapterHeading(data.paragraphs, chapter.title) : data.paragraphs;
      paragraphs.forEach((text, index) => prose.append(el('p', index === 0 && chapter.page === number ? 'drop-cap' : '', text)));
    }
  } catch {
    if (!signal.aborted && renderEpoch === epoch) {
      const notice = el('div', 'scroll-error');
      notice.append(el('p', '', 'This page needs another try.'), button('Try again', 'secondary-button scroll-retry', () => { pageCache.delete(number); render(); }));
      prose.append(notice);
    }
  } finally { page.classList.remove('is-loading'); }
}
function originalScrollPage(number) {
  const page = el('article', 'paper-page scroll-page scroll-original');
  page.dataset.sourcePage = number;
  page.setAttribute('aria-label', `Original PDF page ${number}`);
  const heading = el('div', 'page-running-header');
  heading.append(el('span', '', book.title), el('span', '', 'ORIGINAL'));
  const host = el('div', 'scroll-canvas-host');
  host.append(el('div', 'scroll-loading', 'Setting out your page…'));
  page.append(heading, host, el('div', 'page-number', number));
  return page;
}
async function fillOriginalPage(number, page, { signal, renderEpoch, source }) {
  const host = page.querySelector('.scroll-canvas-host');
  const canvas = el('canvas');
  canvas.setAttribute('aria-label', `Original PDF page ${number}`);
  try {
    await renderPdfPage(source, number, canvas, { scale: smallScreen.matches ? 1 : 1.4, signal, maxPixels: 2_000_000 });
    if (signal.aborted || renderEpoch !== epoch) { canvas.width = 0; canvas.height = 0; return; }
    host.replaceChildren(canvas);
  } catch {
    canvas.width = 0; canvas.height = 0;
    if (!signal.aborted && renderEpoch === epoch) {
      const notice = el('div', 'scroll-error');
      notice.append(el('p', '', 'This page needs another try.'), button('Try again', 'secondary-button scroll-retry', () => { render(); }));
      host.replaceChildren(notice);
    }
  }
}
function fillFragment(page, fragment) {
  const prose = page.querySelector('.page-prose');
  const intro = prose.querySelector('.chapter-intro');
  prose.replaceChildren(...(intro ? [intro] : []));
  if (fragment.kind === 'scan') {
    const notice = el('div', 'scanned-message');
    notice.append(el('p', '', 'This page is better seen in its original form.'), button('View original page ↗', 'secondary-button', () => { navigate(fragment.page); setMode('original'); }));
    prose.append(notice);
  } else if (fragment.kind === 'error') {
    prose.append(el('p', '', 'This page needs another try.'), button('Try again', 'secondary-button', () => { pageCache.delete(fragment.page); render(); }));
  } else {
    fragment.text.split(/\n{2,}/).filter(text => text.trim()).forEach((text, index) => {
      prose.append(el('p', index === 0 && intro ? 'drop-cap' : '', text));
    });
  }
}
function fittedPager({ signal, renderEpoch, source }) {
  const check = () => {
    if (signal.aborted || renderEpoch !== epoch) throw new DOMException('Reading layout changed.', 'AbortError');
  };
  return createBookPager({
    count: pageCount(),
    loadFragments: async number => {
      check();
      if (fragmentCache.has(number)) {
        const fragments = fragmentCache.get(number);
        fragmentCache.delete(number); fragmentCache.set(number, fragments);
        return fragments;
      }
      let data;
      try { data = await pageText(number, source); }
      catch { check(); return [{ start: 0, end: 0, text: '', kind: 'error' }]; }
      check();
      let fragments;
      if (!data.hasText) fragments = [{ start: 0, end: 0, text: '', kind: 'scan' }];
      else {
        const chapter = currentChapter(number);
        const paragraphs = source && chapter.page === number ? removeRepeatedChapterHeading(data.paragraphs, chapter.title) : data.paragraphs;
        const text = paragraphs.join('\n\n');
        const bounds = $('book-spread').getBoundingClientRect();
        const host = el('div', 'book-measure');
        host.setAttribute('aria-hidden', 'true'); host.inert = true;
        host.style.width = `${bounds.width / (smallScreen.matches ? 1 : 2)}px`;
        host.style.height = `${bounds.height}px`;
        const first = paperPage(number, 'left');
        const continuation = paperPage(number, 'left', 1);
        host.append(first, continuation);
        document.body.append(host);
        try {
          fragments = paginateText(text, (slice, { start, end }) => {
            check();
            const page = start === 0 ? first : continuation;
            fillFragment(page, { page: number, start, end, text: slice });
            const prose = page.querySelector('.page-prose');
            // Leave a pixel for rounding at the last line's lower edge.
            const last = prose.lastElementChild;
            return prose.scrollHeight <= prose.clientHeight && (!last || last.getBoundingClientRect().bottom <= prose.getBoundingClientRect().bottom - 1);
          }, { signal });
        } finally { host.remove(); }
      }
      check();
      if (fragmentCache.size >= 6) fragmentCache.delete(fragmentCache.keys().next().value);
      fragmentCache.set(number, fragments);
      return fragments;
    },
  });
}
function readingAnchor() {
  const place = book.bookPosition;
  return { page: book.page, offset: place?.page === book.page && Number.isFinite(place.offset) ? Math.max(0, place.offset) : 0 };
}
function spreadPages(spread) {
  const pages = spread.leaves.map((fragment, i) => {
    const page = paperPage(fragment.page, i === 0 ? 'left' : 'right', fragment.start);
    page.dataset.textEnd = fragment.end;
    fillFragment(page, fragment);
    return page;
  });
  if (!smallScreen.matches && pages.length < 2) pages.push(paperPage(pageCount() + 1, 'right'));
  return pages;
}
function commitSpread(spread, pages, place = spread.anchor) {
  fittedSpread = spread;
  book.page = spread.anchor.page;
  // Rewrapping changes the visible leaf's start, but must not move the saved
  // text anchor backward on every font, window or focus change.
  const sourceEnd = fragmentCache.get(book.page)?.at(-1)?.end || 0;
  book.bookPosition = place.page === book.page ? { page: book.page, offset: Math.min(place.offset, sourceEnd) } : spread.anchor;
  book.scrollPosition = { page: book.page, fraction: 0, view: mode };
  $('book-spread').replaceChildren(...pages);
  updateReadingPosition();
}
async function render() {
  stopReadingRender();
  const renderEpoch = ++epoch;
  const source = pdf;
  fittedSpread = null;
  fragmentCache.clear();
  updateContents();
  updateControls();
  document.body.classList.toggle('scroll-mode', layout === 'scroll');
  $('book-spread').hidden = layout === 'scroll' || mode !== 'book';
  $('original-stage').hidden = layout === 'scroll' || mode !== 'original';
  $('scroll-stage').hidden = layout !== 'scroll';
  // Release the previous view's canvases and prose before creating its replacement.
  $('book-spread').replaceChildren();
  $('original-stage').replaceChildren();
  if (layout === 'scroll') {
    const previous = book.scrollPosition;
    const fraction = previous?.page === book.page && previous.view === mode ? previous.fraction : 0;
    scroller = createPageScroller($('scroll-stage'), {
      count: pageCount(), initialPage: book.page, initialFraction: fraction,
      estimateHeight: mode === 'original' ? 800 : smallScreen.matches ? 500 : 620,
      maxMounted: mode === 'original' ? 4 : 7, overscan: mode === 'original' ? 1 : 2, maxConcurrent: 2,
      createPage: number => mode === 'original' ? originalScrollPage(number) : paperPage(number, 'scroll'),
      loadPage: (number, page, { signal }) => mode === 'original'
        ? fillOriginalPage(number, page, { signal, renderEpoch, source })
        : fillPaperPage(number, page, { signal, renderEpoch, source }),
      onPosition: position => {
        if (renderEpoch !== epoch) return;
        const changed = book.page !== position.page;
        book.page = position.page;
        book.bookPosition = { page: position.page, offset: 0 };
        book.scrollPosition = { ...position, view: mode };
        if (changed) updateReadingPosition();
        if (!starting) scheduleScrollSave();
      },
    });
    return;
  }
  pagedRenderController = new AbortController();
  const signal = pagedRenderController.signal;
  if (mode === 'original' && source) {
    const canvas = el('canvas');
    canvas.setAttribute('aria-label', `Original PDF page ${book.page}`);
    const loading = el('div', 'inline-note', 'Setting out your page…');
    $('original-stage').replaceChildren(loading);
    try {
      await renderPdfPage(source, book.page, canvas, { scale: 1.6, signal, maxPixels: 2_000_000 });
      if (!signal.aborted && renderEpoch === epoch) $('original-stage').replaceChildren(canvas);
      else { canvas.width = 0; canvas.height = 0; }
    } catch (error) { if (!signal.aborted && renderEpoch === epoch) { loading.textContent = 'This page could not be rendered. Try another page.'; toast(error.message); } }
    return;
  }
  $('book-spread').setAttribute('aria-busy', 'true');
  $('book-spread').replaceChildren(paperPage(book.page, 'left'));
  pageFillPromise = (async () => {
    try {
      const anchor = readingAnchor();
      const spread = await fittedPager({ signal, renderEpoch, source }).spread(anchor, step());
      if (signal.aborted || renderEpoch !== epoch) return;
      commitSpread(spread, spreadPages(spread), anchor);
      if (!starting) persist();
    } catch (error) {
      if (error.name !== 'AbortError' && renderEpoch === epoch) toast('That page needs another try. Choose a page or reopen the book.');
    } finally {
      if (renderEpoch === epoch) { $('book-spread').setAttribute('aria-busy', 'false'); updateControls(); }
    }
  })();
  await pageFillPromise;
}
async function flipTo(direction) {
  if (turnController || !fittedSpread) return;
  const controller = new AbortController();
  turnController = controller;
  const renderEpoch = epoch;
  const source = pdf;
  const fromAnchor = fittedSpread.anchor;
  const stage = $('book-spread');
  stage.setAttribute('aria-busy', 'true');
  updateControls();
  try {
    await pageFillPromise;
    const pager = fittedPager({ signal: controller.signal, renderEpoch, source });
    const target = direction === 'next' ? fittedSpread.next : await pager.previous(fromAnchor, step());
    if (!target || (target.page === fromAnchor.page && target.offset === fromAnchor.offset)) return;
    const spread = await pager.spread(target, step());
    const pages = spreadPages(spread);
    if (controller.signal.aborted || renderEpoch !== epoch) return;
    const result = await turnPages({ stage, targetPages: pages, direction: direction === 'next' ? 'forward' : 'backward', singlePage: smallScreen.matches, signal: controller.signal, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    if (result !== 'finished' || controller.signal.aborted || renderEpoch !== epoch) return;
    // Only a completed turn changes the book or its saved source-page anchor.
    pagedRenderController?.abort();
    pagedRenderController = controller;
    commitSpread(spread, pages);
    persist();
  } catch {
    if (!controller.signal.aborted && renderEpoch === epoch) toast('That page needs another try. Use Next or choose its page number.');
  } finally {
    if (turnController === controller) {
      turnController = null;
      stage.setAttribute('aria-busy', 'false');
      updateControls();
    }
  }
}
function navigate(number) {
  if (!Number.isInteger(number) || number < 1 || number > pageCount()) return toast(`Choose a page from 1 to ${pageCount()}.`);
  cancelPageTurn();
  book.page = number;
  book.bookPosition = { page: number, offset: 0 };
  book.scrollPosition = { page: number, fraction: 0, view: mode };
  if (layout === 'scroll' && scroller) {
    scroller.jumpTo(number, { behavior: 'auto' });
    updateReadingPosition();
  } else render();
  persist();
}
function turn(direction) {
  if (turnController) return;
  if (layout === 'pages' && mode === 'book') { flipTo(direction); return; }
  const number = sourcePageNavigation(book.page, pageCount(), step())[direction];
  if (number === null) return;
  navigate(number);
}
$('previous-page').addEventListener('click', () => turn('previous'));
$('next-page').addEventListener('click', () => turn('next'));
$('page-form').addEventListener('submit', event => { event.preventDefault(); navigate(Number($('page-input').value)); });
$('page-input').addEventListener('blur', () => { $('page-input').value = book.page; });
$('progress-slider').addEventListener('change', event => navigate(Number(event.target.value)));
function setMode(value) {
  if (mode === value) return;
  book.bookPosition = { page: book.page, offset: 0 };
  flushScrollSave(); mode = value; render();
}
function setLayout(value) {
  if (layout === value) return;
  book.bookPosition = { page: book.page, offset: 0 };
  flushScrollSave(); layout = value; savePreference('reading-layout', layout); render();
}
$('book-view').addEventListener('click', () => setMode('book'));
$('original-view').addEventListener('click', () => { if (pdf) setMode('original'); });
['pages', 'scroll'].forEach(value => $(`${value}-layout`).addEventListener('click', () => setLayout(value)));
smallScreen.addEventListener('change', () => { flushScrollSave(); render(); });
window.addEventListener('resize', () => {
  cancelPageTurn();
  clearTimeout(resizeTimer);
  if (layout === 'pages' && mode === 'book') resizeTimer = setTimeout(() => { render(); }, 160);
}, { passive: true });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', cancelPageTurn);
let swipeStart = null;
$('book-spread').addEventListener('pointerdown', event => {
  if (layout !== 'pages' || mode !== 'book' || turnController || !['touch', 'pen'].includes(event.pointerType) || event.target.closest('button, input, a')) return;
  swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
}, { passive: true });
document.addEventListener('pointerup', event => {
  const start = swipeStart; swipeStart = null;
  if (!start || start.id !== event.pointerId) return;
  const direction = swipePageDirection({ x: event.clientX - start.x, y: event.clientY - start.y, elapsed: event.timeStamp - start.time, hasSelection: Boolean(window.getSelection()?.toString()) });
  if (direction) turn(direction);
}, { passive: true });
document.addEventListener('pointercancel', () => { swipeStart = null; }, { passive: true });
document.addEventListener('pointerdown', event => {
  if (document.body.classList.contains('contents-open') && !event.target.closest('.contents-panel, #contents-toggle')) closeContents();
}, { passive: true });
$('bookmark-button').addEventListener('click', () => {
  book.bookmarks = book.bookmarks.includes(book.page) ? book.bookmarks.filter(page => page !== book.page) : [...book.bookmarks, book.page].sort((a, b) => a - b);
  updateControls(); persist();
  toast(book.bookmarks.includes(book.page) ? `Page ${book.page} tucked away. Find it on My shelf.` : 'Bookmark removed.');
});
function toggleFocus() {
  cancelPageTurn();
  closeContents();
  const focus = document.body.classList.toggle('focus-mode');
  $('contents-toggle').hidden = focus;
  $('focus-button').setAttribute('aria-label', focus ? 'Leave focus mode' : 'Enter focus mode');
  $('focus-button').setAttribute('aria-pressed', String(focus));
  $('focus-button').title = focus ? 'Leave focus mode (F or Escape)' : 'Focus mode (F)';
  scroller?.reflow();
  if (mode === 'book' && layout === 'pages') render();
}
$('focus-button').addEventListener('click', toggleFocus);
$('contents-toggle').addEventListener('click', () => {
  cancelPageTurn();
  const open = document.body.classList.toggle('contents-open');
  $('contents-toggle').setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if ($('modal').open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); $('next-page').click(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); $('previous-page').click(); }
  if (event.repeat && ['f', 's'].includes(event.key.toLowerCase())) return;
  if (event.key.toLowerCase() === 'f') toggleFocus();
  if (event.key.toLowerCase() === 's') { event.preventDefault(); setLayout(layout === 'scroll' ? 'pages' : 'scroll'); }
  if (event.key === 'Escape') {
    const drawerWasOpen = document.body.classList.contains('contents-open');
    closeContents();
    if (drawerWasOpen) $('contents-toggle').focus();
    if (document.body.classList.contains('focus-mode')) toggleFocus();
  }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { cancelPageTurn(); flushScrollSave(); } });
window.addEventListener('pagehide', () => { cancelPageTurn(); flushScrollSave(); });

function loadingDialog(controller) {
  const content = el('div', 'loading-block');
  const message = el('p', 'modal-copy', 'Opening your book…');
  const progress = el('progress', 'loading-meter');
  content.append(message, progress, actions(button('Cancel', 'secondary-button', () => { controller.abort(); $('modal').close(); })));
  showModal('A new story awaits', content, () => controller.abort());
  return { message, progress };
}
function askPassword(updatePassword, reason, controller) {
  if (controller.signal.aborted) return;
  const form = el('form');
  form.append(el('p', 'modal-copy', reason === 2 ? 'That password did not unlock the PDF. Try again.' : 'This PDF is password protected. Enter its password to read it.'));
  const label = el('label', 'form-field', 'PDF password');
  const input = el('input');
  input.type = 'password'; input.required = true; input.autocomplete = 'off';
  label.append(input);
  const submit = button('Unlock book', 'primary-button', () => form.requestSubmit());
  form.append(label, actions(button('Cancel', 'secondary-button', () => { controller.abort(); $('modal').close(); }), submit));
  // Changing from progress to password must not invoke the previous cancel cleanup.
  modalCleanup = null;
  showModal('Unlock your PDF', form, () => controller.abort());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const password = input.value;
    input.value = '';
    modalCleanup = null;
    loadingDialog(controller);
    updatePassword(password);
  });
}
function importError(error) {
  if (error?.name === 'AbortError') return;
  const messages = {
    InvalidPDFException: 'That file could not be read as a PDF. Try opening it in Chrome first.',
    PasswordException: 'The PDF could not be unlocked. Try importing it again with its password.',
    MissingPDFException: 'The PDF could not be found. Choose the file again.',
  };
  toast(messages[error?.name] || `Could not open this PDF. ${error?.message || 'Please try another file.'}`);
}
async function refreshShelf() {
  try { shelf = await listBooks(); $('shelf-count').textContent = shelf.length; }
  catch { shelf = []; }
}
async function importFile(file) {
  if (!file || importing) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('Choose a PDF file to add to your shelf.');
  if (file.size > 150 * 1024 * 1024) return toast('This PDF is over 150 MB. Choose a smaller copy for this simple reader.');
  const controller = new AbortController();
  importing = controller;
  const status = loadingDialog(controller);
  let candidate;
  try {
    const bytes = await file.arrayBuffer();
    if (controller.signal.aborted) return;
    candidate = await openPdf(bytes, { signal: controller.signal, onPassword: (updatePassword, reason) => askPassword(updatePassword, reason, controller) });
    if (controller.signal.aborted) return;
    modalCleanup = null;
    const scanStatus = loadingDialog(controller);
    const detected = await detectChapters(candidate, { signal: controller.signal, onProgress: (current, total) => {
      scanStatus.message.textContent = `Finding chapter headings · page ${current} of ${total}`;
      scanStatus.progress.max = total; scanStatus.progress.value = current;
    } });
    if (controller.signal.aborted) return;
    const nextBook = { id: crypto.randomUUID(), title: titleFromFilename(file.name), filename: file.name, bytes, ...detected, page: 1, bookmarks: [], addedAt: Date.now() };
    try { await putBook(nextBook); saved = true; bookStored = true; }
    catch { saved = false; bookStored = false; toast('Your PDF is open, but the shelf could not save it. Keep the source file and choose it again next time.'); }
    flushScrollSave(); stopReadingRender(); ++epoch;
    await disposePdf(pdf);
    pdf = candidate; candidate = null; book = nextBook; mode = 'book'; pageCache.clear();
    savePreference('active-book', book.id);
    modalCleanup = null;
    $('modal').close();
    render();
    await refreshShelf();
    if (saved) toast('Your book is ready. Your place will be kept.');
  } catch (error) { if (!controller.signal.aborted) importError(error); }
  finally {
    await disposePdf(candidate);
    if ($('modal').open) { modalCleanup = null; $('modal').close(); }
    importing = null;
  }
}
['import-button','drop-zone'].forEach(id => $(id).addEventListener('click', () => $('file-input').click()));
$('file-input').addEventListener('change', event => { importFile(event.target.files[0]); event.target.value = ''; });
document.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); $('drop-zone').classList.add('drag-over'); }
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('drop-zone').classList.remove('drag-over'); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); $('drop-zone').classList.remove('drag-over');
  importFile(event.dataTransfer.files[0]);
});

async function loadStored(id, page) {
  if (importing) return;
  let candidate;
  const controller = new AbortController();
  importing = controller;
  loadingDialog(controller);
  try {
    const stored = await getBook(id);
    if (!stored) throw new Error('This book is no longer on your shelf.');
    candidate = await openPdf(stored.bytes, { signal: controller.signal, onPassword: (updatePassword, reason) => askPassword(updatePassword, reason, controller) });
    if (controller.signal.aborted) return;
    flushScrollSave(); stopReadingRender(); ++epoch;
    await disposePdf(pdf);
    pdf = candidate; candidate = null; book = stored;
    book.page = Math.min(pdf.numPages, Math.max(1, page || book.page || 1));
    if (page) { book.scrollPosition = { page: book.page, fraction: 0, view: 'book' }; book.bookPosition = { page: book.page, offset: 0 }; }
    mode = 'book'; pageCache.clear(); saved = true; bookStored = true;
    modalCleanup = null; $('modal').close();
    render(); persist();
  } catch (error) { if (!controller.signal.aborted) importError(error); }
  finally { await disposePdf(candidate); importing = null; if ($('modal').open) { modalCleanup = null; $('modal').close(); } }
}
async function useDemo() {
  flushScrollSave(); stopReadingRender(); ++epoch;
  await disposePdf(pdf); pdf = null; mode = 'book'; book = structuredClone(demo); pageCache.clear(); bookStored = true;
  const position = preference('demo', { page: 1, bookmarks: [] });
  book.page = Math.min(8, Math.max(1, position.page)); book.bookmarks = position.bookmarks || [];
  book.scrollPosition = position.scrollPosition;
  book.bookPosition = position.bookPosition;
  savePreference('active-book', 'demo'); $('modal').close(); render();
}
$('library-button').addEventListener('click', async () => {
  if (importing) return toast('Finish opening your PDF, or cancel, before visiting the shelf.');
  await refreshShelf();
  const content = el('div');
  content.append(el('p', 'modal-copy', 'A small collection, all kept in this browser. Pick up where you left off.'));
  if (!shelf.length) content.append(el('p', 'empty-shelf', 'Your shelf is waiting for its first book. Open a PDF to make it yours.'));
  const list = el('div', 'shelf-list');
  shelf.forEach((item, index) => {
    const row = el('div', 'shelf-item');
    const info = el('div', 'shelf-info');
    info.append(el('h3', '', item.title), el('p', 'inline-note', `Last read: page ${item.page} · ${item.chapters.length} chapters`));
    if (item.bookmarks.length) {
      const marks = el('div', 'bookmark-links');
      marks.append(el('span', 'small-label', 'SAVED PAGES '));
      item.bookmarks.forEach(page => marks.append(button(String(page), 'text-button', () => loadStored(item.id, page))));
      info.append(marks);
    }
    row.append(el('span', 'shelf-cover', roman(index + 1)), info, button('Read ↗', 'shelf-open text-button', () => loadStored(item.id)), button('×', 'shelf-remove icon-button', async () => {
      const confirm = el('div');
      confirm.append(el('p', 'modal-copy', `Remove “${item.title}” from this browser’s shelf? Your original PDF file is kept.`), actions(button('Keep book', 'secondary-button', () => $('library-button').click()), button('Remove from shelf', 'danger-button', async () => {
        try { await deleteBook(item.id); if (book.id === item.id) await useDemo(); await refreshShelf(); $('library-button').click(); }
        catch { toast('The book could not be removed. Please try again.'); }
      })));
      showModal('Make room on your shelf', confirm);
    }));
    row.lastElementChild.setAttribute('aria-label', `Remove ${item.title} from shelf`);
    list.append(row);
  });
  content.append(list, el('p', 'inline-note', 'Clearing browser data removes this shelf. Keep your original PDFs as your backup.'), actions(button('Read the sample', 'secondary-button', useDemo), button('Try a sample PDF', 'secondary-button', async () => {
    $('modal').close();
    try {
      const response = await fetch('/sample.pdf');
      if (!response.ok) throw new Error('The sample PDF is unavailable.');
      await importFile(new File([await response.blob()], 'A Little Book of Light.pdf', { type: 'application/pdf' }));
    } catch (error) { importError(error); }
  }), button('Open a PDF', 'primary-button', () => { $('modal').close(); $('file-input').click(); })));
  showModal('Your shelf', content);
});

$('edit-chapters').addEventListener('click', () => {
  if (importing) return;
  if (book.id === 'demo') return;
  const form = el('form');
  form.append(el('p', 'modal-copy', 'Give each chapter a title and the PDF page where it begins. These changes stay on your shelf.'));
  const rows = el('div');
  function addRow(chapter = { title: '', page: book.page }) {
    const row = el('div', 'chapter-edit-row');
    const title = el('input'); title.value = chapter.title; title.placeholder = 'Chapter title'; title.required = true; title.maxLength = 160; title.setAttribute('aria-label', 'Chapter title');
    const page = el('input'); page.type = 'number'; page.value = chapter.page; page.min = 1; page.max = pageCount(); page.required = true; page.setAttribute('aria-label', 'First PDF page');
    const remove = button('×', 'icon-button', () => row.remove()); remove.setAttribute('aria-label', 'Remove chapter');
    row.append(title, page, remove); rows.append(row);
  }
  book.chapters.forEach(addRow);
  const note = el('p', 'inline-note', 'Page numbers refer to the PDF’s source pages, including covers. Chapters are sorted automatically.');
  const error = el('p', 'inline-note'); error.setAttribute('role', 'alert');
  form.append(rows, button('＋ Add a chapter', 'text-button', () => addRow()), note, error, actions(button('Cancel', 'secondary-button', () => $('modal').close()), button('Save chapters', 'primary-button', () => form.requestSubmit())));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const chapters = [...rows.children].map(row => ({ title: row.children[0].value.trim(), page: Number(row.children[1].value) })).sort((a, b) => a.page - b.page);
    if (!chapters.length || chapters.some(c => !c.title || !Number.isInteger(c.page) || c.page < 1 || c.page > pageCount())) { error.textContent = 'Add at least one titled chapter with a valid page.'; return; }
    if (new Set(chapters.map(c => c.page)).size !== chapters.length) { error.textContent = 'Each chapter needs a different first page.'; return; }
    if (chapters[0].page > 1) chapters.unshift({ title: 'Beginning', page: 1 });
    book.chapters = chapters; book.source = 'manual'; $('modal').close(); render(); persist(); toast('Your chapters are arranged.');
  });
  showModal('Arrange your chapters', form);
});
$('appearance-button').addEventListener('click', () => {
  if (importing) return;
  const content = el('div');
  content.append(el('p', 'modal-copy', 'A page that feels right for you.'));
  const label = el('label', 'form-field', 'Book text size');
  const size = el('input'); size.type = 'range'; size.min = 15; size.max = 23; size.value = appearance.size;
  const value = el('span', 'inline-note', `${appearance.size}px`);
  size.addEventListener('input', () => { appearance.size = Number(size.value); value.textContent = `${size.value}px`; applyAppearance(); });
  label.append(size, value);
  const papers = el('div', 'paper-options');
  ['light', 'dark'].forEach(paper => {
    const option = button(paper === 'light' ? 'Warm paper' : 'After hours', `paper-option ${appearance.paper === paper ? 'selected' : ''}`, () => {
      appearance.paper = paper; applyAppearance(); [...papers.children].forEach(node => { const selected = node === option; node.classList.toggle('selected', selected); node.setAttribute('aria-pressed', String(selected)); });
    });
    option.dataset.paper = paper;
    option.setAttribute('aria-pressed', String(appearance.paper === paper)); papers.append(option);
  });
  content.append(label, el('h3', 'small-label', 'PAPER & INK'), papers, el('p', 'inline-note', 'Book view rearranges text. Switch to Original PDF for illustrations, tables, or the exact page layout.'), actions(button('Back to the book', 'primary-button', () => $('modal').close())));
  showModal('Settle in', content);
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
$('launch-help').addEventListener('click', () => {
  if (importing) return;
  const content = el('div');
  content.append(el('p', 'modal-copy', 'Keep your reading room close at hand.'));
  const list = el('ol', 'modal-copy');
  ['Double-click “Start Folio.cmd” in the app folder. It starts the local reader and opens Chrome.', 'Run “Create shortcut.cmd” once to put a Folio launcher on your Desktop. It starts the server for you each time.', 'In Chrome, you can also bookmark this page or install Folio from the browser menu when available.'].forEach(text => list.append(el('li', '', text)));
  content.append(list, el('p', 'inline-note', 'The Desktop launcher needs this app folder and Node.js. An installed Chrome app needs the local server or its saved offline cache. Your books stay in the same Chrome profile.'));
  if (installPrompt) content.append(button('Install Folio in Chrome', 'primary-button', async () => { await installPrompt.prompt(); installPrompt = null; $('modal').close(); }));
  showModal('Your own reading corner', content);
});

async function start() {
  const active = preference('active-book', 'demo');
  const position = preference('demo', { page: 1, bookmarks: [] });
  book.page = Math.min(8, Math.max(1, position.page || 1)); book.bookmarks = position.bookmarks || [];
  book.scrollPosition = position.scrollPosition;
  book.bookPosition = position.bookPosition;
  await render();
  await refreshShelf();
  if (active !== 'demo' && shelf.some(item => item.id === active)) await loadStored(active);
  starting = false;
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
start();
