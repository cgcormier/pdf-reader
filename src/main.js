import { attachContentsDrag } from './contents-drag.js';
import './styles.css';
import './contents-drag.css';
import { attachDesignSwitcher } from './design-switcher.js';
import './design-switcher.css';
import './design-margin.css';
import './design-signal.css';
import './design-common.css';
import { attachImmersiveFocus } from './immersive-focus.js';
import './focus-exit-cue.css';
import { attachFocusExitCue } from './focus-exit-cue.js';
import { openPdf, extractPage, renderPdfPage, titleFromFilename } from './pdf-engine.js';
import { STRUCTURE_VERSION, readDocumentStructure, analyzeDocumentStructure } from './document-structure.js';
import { shouldAutoScanStructure, structureFromLegacy, structureNodes, structurePath, activeStructureNode, chaptersFromNodes, createStructureScanner } from './structure-model.js';
import { demo } from './demo.js';
import { sourcePageIdentity } from './page-identity.js';
import { updateReaderCaption } from './reader-caption.js';
import { removeRepeatedChapterHeading, sourcePageNavigation, swipePageDirection } from './book-layout.js';
import { createPageScroller } from './page-scroll.js';
import { turnPages } from './page-turn.js';
import { attachPageTurnSpeed } from './page-turn-speed.js';
import { FIT_CACHE_LIMIT, paginateTextSteps, createBookPager } from './book-pagination.js';
import { createSpreadBuffer } from './spread-buffer.js';
import { createFitGate } from './fit-gate.js';
import { LAYOUT_VERSION, sourceAt, offsetForSource } from './pdf-layout.js';
import { resolveReadingPosition, readingPosition, paginateLayoutSteps, renderLayout, renderAnnotations, hasSourceChapterTitle } from './layout-reading.js';
import { preference, savePreference, getBook, putBook, updateBook, setBookBookmark, deleteBook, listBooks } from './storage.js';

const $ = id => document.getElementById(id);
// Opt-in audit sink: no text, PDF bytes, or retained production telemetry.
function readerMetric(type, detail = {}) {
  if (typeof window.__folioReaderMetric === 'function') window.__folioReaderMetric({ type, time: performance.now(), ...detail });
}
const smallScreen = matchMedia('(max-width: 820px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const pageTurnSpeed = attachPageTurnSpeed(reducedMotion);
attachFocusExitCue();
attachContentsDrag();
attachDesignSwitcher();
let book = structuredClone(demo);
let pdf = null;
let mode = 'book';
let layout = preference('reading-layout', 'pages') === 'pages' ? 'pages' : 'scroll';
let scroller = null;
let pagedRenderController = null;
let turnController = null;
let pendingTurn = null;
let turnCompletion = Promise.resolve();
let finishTurnsForLayout = false;
let pageFillPromise = Promise.resolve();
let fittedSpread = null;
let spreadPreparation = null;
let spreadWarmup = null;
let interruptedRender = false;
const fitGate = createFitGate();
const fragmentCache = new Map();
let fragmentCharacters = 0;
const fragmentCharacterBudget = 250_000;
let contentsSnapshot = null;
let highlightedContents = new Set();
const contentsLinks = new Map();
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
let selectedStructureId = null;
let structureScan = null;
let structureNavigationEpoch = 0;
const appearance = preference('appearance', { size: 17, paper: 'light' });
const roman = n => ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][n - 1] || String(n);
const pageCount = () => pdf?.numPages || demo.pages.length;
const hasNoReadableText = () => pdf && book.structure?.version === STRUCTURE_VERSION && book.structure.status === 'complete'
  && book.structure.textPages === 0 && !book.structure.failedPages?.length
  && book.structure.scannedPages?.length === pdf.numPages;
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
function attachTextSizeScrubber() {
  const minimum = 6;
  const maximum = 23;
  const pixelsPerStep = 18;
  const scrubber = $('appearance-button');
  const ruler = $('text-size-ruler');
  const value = $('text-size-ruler-value');
  const marker = $('text-size-ruler-marker');
  let drag = null;

  scrubber.setAttribute('role', 'slider');
  scrubber.setAttribute('aria-label', 'Book text size');
  scrubber.setAttribute('aria-valuemin', String(minimum));
  scrubber.setAttribute('aria-valuemax', String(maximum));
  scrubber.setAttribute('aria-orientation', 'horizontal');
  ruler.hidden = true;

  function setSize(nextSize) {
    const size = Math.max(minimum, Math.min(maximum, Math.round(Number(nextSize) || appearance.size || 17)));
    appearance.size = size;
    value.textContent = `${size}px`;
    scrubber.setAttribute('aria-valuenow', String(size));
    scrubber.setAttribute('aria-valuetext', `${size} pixels`);
    marker.style.setProperty('--text-size-position', `${(size - minimum) / (maximum - minimum) * 100}%`);
    applyAppearance();
  }
  function finishScrub(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    if (scrubber.hasPointerCapture?.(drag.pointerId)) scrubber.releasePointerCapture(drag.pointerId);
    drag = null;
    scrubber.classList.remove('is-scrubbing');
    ruler.hidden = true;
  }

  setSize(appearance.size);
  scrubber.addEventListener('pointerdown', event => {
    if (importing || event.button !== 0) return;
    event.preventDefault();
    scrubber.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, startX: event.clientX, startSize: appearance.size };
    scrubber.setPointerCapture(event.pointerId);
    scrubber.classList.add('is-scrubbing');
    ruler.hidden = false;
  });
  scrubber.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setSize(drag.startSize + Math.round((event.clientX - drag.startX) / pixelsPerStep));
  });
  scrubber.addEventListener('pointerup', finishScrub);
  scrubber.addEventListener('pointercancel', finishScrub);
  scrubber.addEventListener('lostpointercapture', finishScrub);
  scrubber.addEventListener('keydown', event => {
    if (importing) return;
    let nextSize;
    if (event.key === 'Home') nextSize = minimum;
    else if (event.key === 'End') nextSize = maximum;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextSize = appearance.size - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextSize = appearance.size + 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    setSize(nextSize);
  });
}
function applyAppearance() {
  const scrollAnchor = layout === 'scroll' && mode === 'book' ? captureScrollAnchor(book.page) : null;
  document.documentElement.style.setProperty('--reading-size', `${Math.max(6, Math.min(23, appearance.size || 17))}px`);
  document.body.classList.toggle('dark-paper', appearance.paper === 'dark');
  document.documentElement.style.colorScheme = appearance.paper === 'dark' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = appearance.paper === 'dark' ? '#2c251e' : '#eee7d8';
  const paperButton = $('paper-button');
  if (paperButton) {
    const isDark = appearance.paper === 'dark';
    paperButton.setAttribute('aria-pressed', String(isDark));
    paperButton.setAttribute('aria-label', isDark ? 'Use warm paper' : 'Use after-hours paper');
    paperButton.title = isDark ? 'Use warm paper' : 'Use after-hours paper';
  }
  savePreference('appearance', appearance);
  scroller?.reflow();
  if (scrollAnchor) restoreScrollAnchor(scrollAnchor);
  if (pagedRenderController && mode === 'book' && layout === 'pages') render();
}
applyAppearance();
attachTextSizeScrubber();
$('paper-button').addEventListener('click', () => {
  if (importing) return;
  appearance.paper = appearance.paper === 'dark' ? 'light' : 'dark';
  applyAppearance();
});
function currentChapter(page = book.page) {
  return book.chapters.filter(chapter => chapter.page <= page).at(-1) || book.chapters[0];
}
function contentsNodes() {
  if (!contentsSnapshot || contentsSnapshot.structure !== book.structure || contentsSnapshot.chapters !== book.chapters || contentsSnapshot.count !== pageCount()) {
    contentsSnapshot = { structure: book.structure, chapters: book.chapters, count: pageCount(),
      nodes: structureNodes(book.structure || structureFromLegacy(book.chapters, pageCount()), pageCount()) };
  }
  return contentsSnapshot.nodes;
}
function ensureStructure() {
  book.structure ||= structureFromLegacy(book.chapters, pageCount());
  book.contentsExpanded ||= {};
}
function expandContents(path) {
  let changed = false;
  for (const node of path) {
    if (book.contentsExpanded[node.id] === true) continue;
    book.contentsExpanded[node.id] = true;
    changed = true;
  }
  if (changed && !starting) persist({ contentsExpanded: book.contentsExpanded });
  return changed;
}
function stopStructureScan(markCancelled = false) {
  ++structureNavigationEpoch;
  structureScan?.cancel(); structureScan = null;
  if (markCancelled && book.structure?.status === 'scanning') {
    book.structure.status = 'cancelled'; persist({ structure: book.structure });
  }
}
async function startStructureScan(fresh = false) {
  if (!pdf || importing) return;
  stopStructureScan();
  const source = pdf;
  const target = book;
  const scan = createStructureScanner(analyzeDocumentStructure, {
    onUpdate: snapshot => {
      if (book !== target || pdf !== source) return;
      const furnitureChanged = JSON.stringify(target.structure?.furniture ?? {}) !== JSON.stringify(snapshot.furniture ?? {});
      if (furnitureChanged && layout === 'scroll' && mode === 'book') book.bookPosition = captureScrollAnchor(book.page) ?? book.bookPosition;
      target.structure = snapshot;
      if (furnitureChanged) pageCache.clear();
      target.scannedPages = snapshot.scannedPages.length;
      const chapters = chaptersFromNodes(structureNodes(snapshot, source.numPages));
      const chaptersChanged = JSON.stringify(chapters) !== JSON.stringify(target.chapters);
      target.chapters = chapters;
      // Only a complete, successful scan can rule out text in later pages.
      if (mode === 'book' && hasNoReadableText()) setMode('original');
      // Saved chapter intros and fitted leaves must follow an upgraded detector.
      else if (chaptersChanged || furnitureChanged) void render();
      updateContents(); updateReadingPosition();
      persist({ structure: snapshot, chapters, scannedPages: target.scannedPages });
    },
    onError: () => {
      if (book !== target) return;
      target.structure.status = 'error'; updateContents(); persist({ structure: target.structure });
      toast('Contents scanning paused. Your reading place is kept. Try scanning again.');
    },
    onFinish: () => { if (structureScan === scan) { structureScan = null; updateContents(); } },
  });
  structureScan = scan;
  let initial = fresh ? undefined : target.structure;
  if (initial?.version !== STRUCTURE_VERSION) initial = undefined;
  if (target.structure) target.structure.status = 'scanning';
  updateContents();
  await scan.start(source, initial);
}
function maybeScanStructure() {
  ensureStructure();
  if (book.id !== 'demo' && shouldAutoScanStructure(book.structure, STRUCTURE_VERSION)) void startStructureScan();
}
function structureStatus() {
  if (book.id === 'demo') return 'A short read to make yourself at home.';
  const structure = book.structure;
  if (!structure) return 'Your saved contents. Scan the PDF to find parts and sections.';
  const scanned = structure.scannedPages?.length || 0;
  const failures = structure.failedPages?.length || 0;
  if (structure.status === 'scanning') return `Finding contents · ${scanned} of ${pageCount()} pages checked. You can keep reading.`;
  if (structure.status === 'cancelled') return `Scan stopped · ${scanned} of ${pageCount()} pages checked. Resume whenever you like.`;
  if (structure.status === 'error') return `Scan paused after ${scanned} pages. Your reading place is kept.`;
  if (structure.status !== 'complete') return 'Contents from your PDF. Checking for additional parts and sections.';
  const progress = `${scanned} of ${pageCount()} pages checked${failures ? ` · ${failures} unreadable` : ''}.`;
  const text = structure.textPages > 0
    ? `Readable text found on ${structure.textPages} pages.`
    : 'No readable page text found. Use Original PDF.';
  const outline = structure.nodes.some(node => node.source === 'outline');
  const navigation = outline ? 'PDF outline navigation is available.'
    : structure.pageNavigation?.length ? 'PDF page bookmarks are available.' : 'Use the PDF page number to navigate.';
  return `${progress} ${text} ${navigation}`;
}
function updateStructureTools() {
  let tools = $('structure-tools');
  if (!tools) {
    tools = el('div', 'structure-tools'); tools.id = 'structure-tools';
    tools.append(button('Scan PDF', 'text-button', () => startStructureScan(book.structure?.status === 'complete' && !book.structure.failedPages?.length)),
      button('Stop scan', 'text-button', () => { stopStructureScan(true); updateContents(); }));
    $('chapter-note').after(tools);
  }
  tools.hidden = book.id === 'demo';
  const [scan, stop] = tools.children;
  const running = Boolean(structureScan?.running) || book.structure?.status === 'scanning';
  scan.hidden = running; scan.disabled = Boolean(importing);
  scan.textContent = ['cancelled', 'error'].includes(book.structure?.status) ? 'Resume scan' : book.structure?.failedPages?.length ? 'Retry unreadable pages' : 'Scan PDF again';
  stop.hidden = !running; stop.disabled = Boolean(importing);
}
async function navigateStructure(node) {
  cancelPageTurn();
  const navigationEpoch = ++structureNavigationEpoch;
  const source = pdf;
  const target = book;
  selectedStructureId = node.id;
  let offset = 0;
  let fraction = 0;
  if (source && (node.y != null || node.kind === 'section')) {
    try {
      const [data, page] = await Promise.all([pageText(node.page, source), source.getPage(node.page)]);
      if (book !== target || pdf !== source || navigationEpoch !== structureNavigationEpoch) return;
      const chapter = currentChapter(node.page);
      const paragraphs = chapter.page === node.page ? removeRepeatedChapterHeading(data.paragraphs, chapter.title) : data.paragraphs;
      const text = data.layout?.projection.text ?? paragraphs.join('\n\n');
      const normalize = value => value.replace(/[\s\p{P}]+/gu, '').toLowerCase();
      const needle = normalize(node.title);
      // Preserve indexes into the exact text string used by pagination.
      let compact = ''; const indexes = [];
      for (let index = 0; index < text.length; index++) {
        if (/[\s\p{P}]/u.test(text[index])) continue;
        const folded = text[index].toLowerCase();
        compact += folded; for (let i = 0; i < folded.length; i++) indexes.push(index);
      }
      const match = needle ? compact.indexOf(needle) : -1;
      if (match >= 0) offset = indexes[match];
      if (data.layout && node.y != null) {
        const line = data.layout.lines.filter(l => Math.abs(l.sourceY - node.y) < 3)
          .sort((a, b) => Math.abs(a.sourceY - node.y) - Math.abs(b.sourceY - node.y))[0];
        if (line) offset = line.start;
      }
      const height = page.view[3] - page.view[1];
      fraction = node.y != null && height > 0 ? Math.max(0, Math.min(0.98, (page.view[3] - node.y) / height)) : offset / Math.max(1, text.length);
    } catch { /* A valid page destination remains usable without an exact text anchor. */ }
  }
  if (book !== target || pdf !== source || navigationEpoch !== structureNavigationEpoch) return;
  expandContents(structurePath(contentsNodes(), node.id));
  navigate(node.page);
  selectedStructureId = node.id;
  if (mode === 'book') book.bookPosition = { page: node.page, offset, layoutVersion: LAYOUT_VERSION, contentsId: node.id };
  book.scrollPosition = { page: node.page, fraction, view: mode };
  if (layout === 'scroll' && scroller) scroller.jumpTo(node.page, { fraction, behavior: 'auto' });
  else if (mode === 'book' && offset > 0) render();
  updateContents(); updateReadingPosition(); persist(); closeContents();
}
function closeContents() {
  document.body.classList.remove('contents-open');
  $('contents-toggle').setAttribute('aria-expanded', 'false');
}
$('contents-close').addEventListener('click', closeContents);
function updateContents() {
  ensureStructure();
  $('chapter-list').setAttribute('aria-label', 'Document contents');
  const nodes = contentsNodes();
  const active = activeStructureNode(nodes, book.page, selectedStructureId);
  const path = new Set(structurePath(nodes, active?.id).map(node => node.id));
  const focused = document.activeElement?.dataset?.contentsFocus;
  const scrollTop = $('chapter-list').scrollTop;
  const fragment = document.createDocumentFragment();
  contentsLinks.clear();
  const append = (parentId, host, depth = 0) => {
    const list = el('ul', 'contents-list');
    for (const node of nodes.filter(entry => entry.parentId === parentId)) {
      const item = el('li', 'contents-item');
      const row = el('div', 'contents-row');
      row.classList.toggle('active-parent', path.has(node.id) && node.id !== active?.id);
      const children = nodes.some(entry => entry.parentId === node.id);
      const open = book.contentsExpanded[node.id] ?? (node.kind === 'part' || path.has(node.id));
      if (children) {
        const toggle = button(open ? '▾' : '▸', 'contents-disclosure', () => {
          book.contentsExpanded[node.id] = !open; updateContents(); persist({ contentsExpanded: book.contentsExpanded });
        });
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${node.title}`);
        toggle.setAttribute('aria-controls', `contents-group-${node.id}`);
        toggle.dataset.contentsFocus = `toggle-${node.id}`;
        row.append(toggle);
      } else row.append(el('span', 'contents-disclosure-spacer'));
      const link = button('', 'chapter-link structure-link', () => navigateStructure(node));
      contentsLinks.set(node.id, link);
      link.dataset.nodeId = node.id; link.dataset.contentsFocus = node.id; link.dataset.page = node.page;
      link.classList.toggle('active', node.id === active?.id);
      if (node.id === active?.id) link.setAttribute('aria-current', 'location');
      link.title = `${node.title} · PDF page ${node.page}${node.pageLabel && node.pageLabel !== String(node.page) ? ` (printed ${node.pageLabel})` : ''} · ${node.source}${node.evidence?.length ? `: ${node.evidence.join(', ')}` : ''}`;
      link.append(el('span', 'chapter-label', node.title), el('span', 'chapter-page', node.page));
      row.append(link); item.append(row);
      if (children && depth < nodes.length) {
        const group = el('div', 'contents-group'); group.id = `contents-group-${node.id}`; group.hidden = !open;
        append(node.id, group, depth + 1); item.append(group);
      }
      list.append(item);
    }
    host.append(list);
  };
  append(null, fragment);
  if (!nodes.length) fragment.append(el('p', 'inline-note', 'Finding the document’s headings…'));
  const pageBookmarks = book.structure?.pageNavigation || [];
  if (pageBookmarks.length) {
    // Scanner destinations remain useful without becoming chapter identities.
    const details = el('details', 'page-bookmarks');
    details.open = Boolean($('chapter-list').querySelector('.page-bookmarks')?.open);
    details.append(el('summary', 'text-button', `PDF page bookmarks (${pageBookmarks.length})`));
    const list = el('ul', 'contents-list');
    for (const node of pageBookmarks) {
      const item = el('li', 'contents-item');
      const link = button('', 'chapter-link structure-link', () => navigateStructure(node));
      link.dataset.pageBookmark = node.id; link.dataset.contentsFocus = node.id;
      link.title = `${node.title} · PDF page ${node.page}`;
      link.append(el('span', 'chapter-label', node.title), el('span', 'chapter-page', node.page));
      item.append(link); list.append(item);
    }
    details.append(list); fragment.append(details);
  }
  $('chapter-list').replaceChildren(fragment);
  highlightedContents = path;
  $('current-chapter').dataset.activeId = active?.id || '';
  $('chapter-list').scrollTop = scrollTop;
  if (focused) [...$('chapter-list').querySelectorAll('[data-contents-focus]')].find(node => node.dataset.contentsFocus === focused)?.focus({ preventScroll: true });
  $('book-title').textContent = book.title;
  $('book-author').textContent = book.author || `${pageCount()} pages · Your personal edition`;
  $('book-type').textContent = book.id === 'demo' ? 'A FOLIO ORIGINAL' : 'FROM YOUR SHELF';
  $('original-view').disabled = !pdf;
  $('text-help-button').hidden = !pdf;
  $('book-view').disabled = Boolean(hasNoReadableText());
  $('book-view').title = hasNoReadableText() ? 'This PDF has no readable text layer. Use Original PDF.' : '';
  $('chapter-note').textContent = structureStatus();
  $('chapter-note').setAttribute('role', 'status');
  updateStructureTools();
  $('current-chapter').textContent = active?.title || currentChapter().title;
  $('current-chapter').title = structurePath(nodes, active?.id).map(node => node.title).join(' › ');
  $('read-time').textContent = book.id === 'demo' ? 'TAKE YOUR TIME' : `${pageCount()} PAGES, AT YOUR PACE`;
  document.title = `${book.title} — Folio`;
}
function updateControls() {
  updateReaderCaption($('reading-caption'), mode);
  $('immersive-page-number').textContent = String(book.page);
  $('immersive-page-number').setAttribute('aria-label', `Source page ${book.page}. Leave fullscreen reading`);
  const count = pageCount();
  const navigation = sourcePageNavigation(book.page, count, step());
  const fitted = mode === 'book' && layout === 'pages' ? fittedSpread : null;
  const end = fitted?.leaves.at(-1)?.page || navigation.end;
  const continued = fitted?.anchor.offset > 0;
  const identity = sourcePageIdentity(book.page, end, count, continued);
  if (document.activeElement !== $('page-input')) $('page-input').value = book.page;
  $('page-input').max = count;
  $('page-position-label').textContent = identity.label;
  $('total-pages').textContent = identity.tail;
  $('page-input').setAttribute('aria-label', 'Go to source page');
  $('progress-slider').max = count;
  $('progress-slider').value = book.page;
  $('progress-slider').setAttribute('aria-valuetext', identity.description);
  const atEnd = fitted ? fitted.next === null : navigation.end === count;
  const sourceLength = fragmentCache.get(book.page)?.at(-1)?.end || fitted?.leaves[0]?.layout?.projection.text.length || 1;
  const fraction = fitted ? Math.min(1, (book.bookPosition?.offset || 0) / sourceLength) : 0;
  const percent = atEnd ? 100 : fitted ? Math.floor((book.page - 1 + fraction) / count * 100) : Math.round((book.page - 1) / Math.max(1, count - 1) * 100);
  $('progress-percent').textContent = `${percent}%`;
  $('progress-slider').style.setProperty('--progress', `${percent}%`);
  $('progress-text').textContent = percent === 0 ? 'The beginning of something good.' : percent === 100 ? 'A good place to pause.' : 'One page at a time.';
  $('previous-page').disabled = mode === 'book' && layout === 'pages' ? !fitted || !turnController && (fitted.anchor.page === 1 && fitted.anchor.offset === 0) : navigation.previous === null;
  const navigationUnit = mode === 'book' && layout === 'pages'
    ? smallScreen.matches ? 'leaf' : 'spread' : 'PDF page';
  $('previous-page').setAttribute('aria-label', `Previous ${navigationUnit}`);
  $('next-page').setAttribute('aria-label', `Next ${navigationUnit}`);
  $('next-page').disabled = mode === 'book' && layout === 'pages' ? !fitted || !turnController && fitted.next === null : navigation.next === null;
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
  pageTurnSpeed.setAvailable(mode === 'book' && layout === 'pages');
  const flipHint = smallScreen.matches ? 'Swipe or ← → to flip · S to scroll' : '← → to flip · S to scroll';
  $('navigation-hint').textContent = layout === 'scroll' ? 'Scroll at your own pace · S to flip' : mode === 'book' ? flipHint : '← → for pages · S to scroll';
  $('save-status').textContent = saved ? 'Your place is kept, automatically.' : 'Reading now. Local saving is unavailable.';
}
async function persist(changes = {
  page: book.page,
  scrollPosition: book.scrollPosition,
  // Original PDF navigation leaves the last Book-view anchor intact.
  ...(mode === 'book' ? { bookPosition: book.bookPosition } : {}),
}, defaults) {
  const id = book.id;
  savePreference('active-book', id);
  if (id === 'demo') {
    // Demo preferences replace their record instead of merging changed fields.
    saved = savePreference('demo', { page: book.page, readingLayout: layout, bookmarks: book.bookmarks,
      scrollPosition: book.scrollPosition, bookPosition: book.bookPosition });
  } else {
    try {
      if (!bookStored) throw new Error('Book is not saved.');
      await updateBook(id, structuredClone(changes), defaults);
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
  const nodes = contentsNodes();
  const chapter = activeStructureNode(nodes, book.page, selectedStructureId);
  const path = new Set(structurePath(nodes, chapter?.id).map(node => node.id));
  // Reveal the active branch when a page change enters a collapsed group.
  if (chapter && $('current-chapter').dataset.activeId !== chapter.id) {
    if (expandContents(structurePath(nodes, chapter.id).slice(0, -1))) updateContents();
  }
  // Only the former/current branch can change its highlight during a turn.
  for (const id of new Set([...highlightedContents, ...path])) {
    const link = contentsLinks.get(id);
    if (!link) continue;
    const active = link.dataset.nodeId === chapter?.id;
    link.classList.toggle('active', active);
    link.parentElement.classList.toggle('active-parent', !active && path.has(link.dataset.nodeId));
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  highlightedContents = path;
  $('current-chapter').dataset.activeId = chapter?.id || '';
  $('current-chapter').textContent = chapter?.title || currentChapter().title;
  $('current-chapter').title = structurePath(nodes, chapter?.id).map(node => node.title).join(' › ');
  updateControls();
}
function stopReadingRender() {
  stopSpreadWarmup();
  spreadPreparation?.buffer.clear(); spreadPreparation = null;
  cancelPageTurn();
  scroller?.destroy(); scroller = null;
  pagedRenderController?.abort(); pagedRenderController = null;
}
function cancelPageTurn() {
  readerMetric('cancel-request');
  pendingTurn = null;
  swipeStart = null;
  stopSpreadWarmup();
  if (!fittedSpread && spreadPreparation) {
    spreadPreparation.controller.abort(); spreadPreparation.buffer.clear();
    spreadPreparation = null;
    // An initial fit has no committed pages to restore. Resume it after the
    // modal/visibility/resize interruption, with a fresh typography generation.
    interruptedRender = true;
    queueMicrotask(resumeInterruptedRender);
  }
  if (!turnController && !fittedSpread) return;
  turnController?.abort();
  turnController = null;
  if (fittedSpread && spreadPreparation) {
    // Foreground and idle work share this generation. Abort both before replacing
    // it, retaining only the currently displayed nodes for a safe next request.
    const previous = spreadPreparation;
    previous.controller.abort(); previous.buffer.clear();
    spreadPreparation = createSpreadPreparation(previous.context);
    const pages = [...$('book-spread').children].filter(node => node.classList.contains('paper-page'));
    spreadPreparation.buffer.remember(fittedSpread.anchor, { spread: fittedSpread, pages });
  }
  $('book-spread').setAttribute('aria-busy', 'false');
  updateControls();
  readerMetric('cancelled');
}
function resumeInterruptedRender() {
  if (interruptedRender && !resizeTimer && !$('modal').open && document.visibilityState !== 'hidden') render();
}
$('modal').addEventListener('close', resumeInterruptedRender);
function stopSpreadWarmup() {
  if (!spreadWarmup) return;
  if (spreadWarmup.idle) window.cancelIdleCallback(spreadWarmup.handle);
  else clearTimeout(spreadWarmup.handle);
  spreadWarmup = null;
}
function warmSpreads() {
  stopSpreadWarmup();
  const preparation = spreadPreparation;
  const origin = fittedSpread;
  const valid = () => preparation && preparation === spreadPreparation && !preparation.signal.aborted
    && origin === fittedSpread && !turnController && document.visibilityState !== 'hidden' && !$('modal').open;
  if (!valid()) return;
  const work = async () => {
    spreadWarmup = null;
    if (!valid()) return;
    const started = performance.now();
    readerMetric('warmup-start');
    try {
      // Touch the previous spread before inserting a new next spread, so LRU
      // eviction releases the distant spread rather than the one just left.
      const previous = await preparation.pager.previous(origin.anchor, step());
      if (valid() && (previous.page !== origin.anchor.page || previous.offset !== origin.anchor.offset)) {
        await preparation.buffer.get(previous);
      }
      if (valid() && origin.next) await preparation.buffer.get(origin.next);
    } catch { /* Speculative failure stays retryable by the next actual turn. */ }
    finally { readerMetric('warmup-end', { duration: performance.now() - started }); }
  };
  spreadWarmup = typeof window.requestIdleCallback === 'function'
    ? { idle: true, handle: window.requestIdleCallback(work, { timeout: 600 }) }
    : { idle: false, handle: setTimeout(work, 120) };
}
async function pageText(number, source = pdf) {
  if (!source) return { paragraphs: demo.pages[number - 1], hasText: true };
  if (!pageCache.has(number)) {
    if (pageCache.size >= 6) pageCache.delete(pageCache.keys().next().value);
    const started = performance.now();
    const pending = extractPage(source, number, { furniture: book.structure?.furniture?.[number] ?? [] }).finally(() => readerMetric('extraction', { page: number, duration: performance.now() - started }));
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
    // Unnumbered Contents headings must not advance the chapter ordinal.
    const chapterNumber = chapter.chapterNumber || book.chapters.filter(entry => entry.page <= number && (!entry.kind || entry.kind === 'chapter')).length;
    const kicker = chapter.kind === 'appendix' ? 'APPENDIX' : (!chapter.kind || chapter.kind === 'chapter') ? `CHAPTER ${roman(Number(chapterNumber))}` : '';
    if (kicker) title.append(el('div', 'chapter-kicker', kicker));
    title.append(heading, el('div', 'chapter-ornament', '✦'));
    prose.append(title);
  }
  page.dataset.textOffset = offset;
  const identity = sourcePageIdentity(number, number, pageCount(), offset > 0);
  page.setAttribute('aria-label', identity.leafDescription);
  const pageNumber = el('div', 'page-number', `${number}${offset ? ' · continued' : ''}`);
  pageNumber.title = identity.leafDescription;
  pageNumber.setAttribute('aria-label', identity.leafDescription);
  page.append(prose, pageNumber);
  return page;
}
function prepareLayoutProse(prose, pageLayout, number) {
  if (hasSourceChapterTitle(pageLayout, currentChapter(number).title)) prose.querySelector('.chapter-intro')?.remove();
}
function appendLayoutExtras(page, pageLayout, number) {
  if (page.querySelector('.layout-source-notes') || (!pageLayout.annotations.length && !pageLayout.fallbacks.length)) return;
  const notes = button(pageLayout.fallbacks.length ? 'Source notes · check Original' : `Source notes (${pageLayout.annotations.length})`, 'text-button layout-source-notes', () => {
    const content = el('div');
    for (const fallback of pageLayout.fallbacks) content.append(el('p', 'inline-note', fallback.reason));
    renderAnnotations(content, pageLayout);
    content.append(button('View original page ↗', 'secondary-button', () => { $('modal').close(); navigate(number); setMode('original'); }));
    showModal(`Source page ${number}`, content);
  });
  page.insertBefore(notes, page.querySelector('.page-number'));
}
function captureScrollAnchor(number) {
  const page = $('scroll-stage')?.querySelector(`[data-source-page="${number}"]`);
  if (!page?.layoutModel) return null;
  const readingY = $('scroll-stage').getBoundingClientRect().top + 18;
  const nodes = [...page.querySelectorAll('[data-layout-start]')];
  const node = nodes.find(n => n.getBoundingClientRect().bottom > readingY) ?? nodes.at(-1);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  const y = Math.max(box.top + 1, Math.min(box.bottom - 1, readingY));
  const caret = document.caretRangeFromPoint?.(box.left + Math.min(18, box.width / 4), y);
  let offset = Number(node.dataset.layoutStart);
  if (caret && node.contains(caret.startContainer)) {
    const before = document.createRange(); before.selectNodeContents(node);
    before.setEnd(caret.startContainer, caret.startOffset); offset += before.toString().length;
  }
  return readingPosition(page.layoutModel, number, offset, book.bookPosition);
}
function restoreScrollAnchor(position) {
  const page = $('scroll-stage')?.querySelector(`[data-source-page="${position.page}"]`);
  if (!page?.layoutModel || !scroller || !position.source) return;
  // Initial loading still has estimated page heights until ResizeObserver runs.
  // Resolve the source against measured geometry before restoring its fraction.
  scroller.reflow();
  const offset = offsetForSource(page.layoutModel.projection, position.source);
  const nodes = [...page.querySelectorAll('[data-layout-start]')];
  const node = nodes.find(n => Number(n.dataset.layoutStart) <= offset && Number(n.dataset.layoutEnd) > offset);
  if (!node) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let remaining = offset - Number(node.dataset.layoutStart); let textNode;
  while ((textNode = walker.nextNode())) { if (remaining < textNode.length) break; remaining -= textNode.length; }
  const range = document.createRange();
  if (textNode) { range.setStart(textNode, remaining); range.setEnd(textNode, Math.min(textNode.length, remaining + 1)); }
  else range.selectNodeContents(node);
  const pageBox = page.getBoundingClientRect(); const box = range.getBoundingClientRect();
  scroller.jumpTo(position.page, { fraction: Math.max(0, (box.top - pageBox.top) / pageBox.height), behavior: 'auto' });
}
async function fillPaperPage(number, page, { signal, renderEpoch, source }) {
  const prose = page.querySelector('.page-prose');
  page.classList.add('is-loading');
  try {
    const data = await pageText(number, source);
    if (signal.aborted || renderEpoch !== epoch) return;
    if (!data.hasText) {
      await fillScannedPage(number, page, { signal, renderEpoch, source });
    } else {
      const chapter = currentChapter(number);
      const paragraphs = source && chapter.page === number ? removeRepeatedChapterHeading(data.paragraphs, chapter.title) : data.paragraphs;
      if (data.layout) {
        page.layoutModel = data.layout;
        prepareLayoutProse(prose, data.layout, number);
        renderLayout(prose, data.layout, { decorate: chapter.page === number });
        appendLayoutExtras(page, data.layout, number);
      } else paragraphs.forEach((text, index) => prose.append(el('p', index === 0 && chapter.page === number ? 'drop-cap' : '', text)));
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
async function fillScannedPage(number, page, context) {
  page.classList.add('scan-page');
  const host = el('div', 'scroll-canvas-host');
  page.querySelector('.page-prose').replaceChildren(host);
  await fillOriginalPage(number, page, context);
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
  if (fragment.kind === 'error') {
    prose.append(el('p', '', 'This page needs another try.'), button('Try again', 'secondary-button', () => { pageCache.delete(fragment.page); render(); }));
  } else if (fragment.kind === 'overflow') {
    prose.append(el('p', 'inline-note', 'This leaf is too small for the source text.'), button('View original page ↗', 'secondary-button', () => { navigate(fragment.page); setMode('original'); }));
  } else if (fragment.layout) {
    prepareLayoutProse(prose, fragment.layout, fragment.page);
    renderLayout(prose, fragment.layout, { start: fragment.start, end: fragment.end, decorate: !!intro });
    appendLayoutExtras(page, fragment.layout, fragment.page);
  } else {
    fragment.text.split(/\n{2,}/).filter(text => text.trim()).forEach((text, index) => {
      prose.append(el('p', index === 0 && intro ? 'drop-cap' : '', text));
    });
  }
}
async function fitPageSteps(steps, fits, check, signal) {
  const measured = new Map();
  let batch = performance.now(); let requests = 0;
  let step = steps.next();
  while (!step.done) {
    check();
    // Idle timeout does not grant an unbounded task. Yield at the same budget
    // for foreground and speculative work; a single DOM probe is indivisible.
    if (performance.now() - batch >= 8 || requests >= 32) {
      readerMetric('fit-yield', { duration: performance.now() - batch, requests });
      await new Promise(resolve => setTimeout(resolve, 0));
      check(); batch = performance.now(); requests = 0;
    }
    // The requested spread is ready before this gate closes. Pause speculative
    // fitting during the turn without blocking shared foreground preparation.
    if (fitGate.paused) {
      readerMetric('fit-yield', { duration: performance.now() - batch, requests });
      while (fitGate.paused) {
        await fitGate.wait(signal);
        check();
      }
      batch = performance.now(); requests = 0;
    }
    const fragment = step.value; const key = `${fragment.start}:${fragment.end}`;
    let result;
    if (measured.has(key)) { result = measured.get(key); readerMetric('fit-reuse'); }
    else {
      result = fits(fragment.text, fragment);
      check();
      if (measured.size >= FIT_CACHE_LIMIT) measured.delete(measured.keys().next().value);
      measured.set(key, result);
    }
    check(); requests++;
    step = steps.next(result);
  }
  readerMetric('fit-slice-end', { duration: performance.now() - batch, requests, entries: measured.size });
  return step.value;
}
function fittedPager({ signal, renderEpoch, source }) {
  const check = () => {
    if (signal.aborted || renderEpoch !== epoch) throw new DOMException('Reading layout changed.', 'AbortError');
  };
  const pending = new Map();
  const load = async number => {
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
    // Another consumer may have finished fitting while extraction was pending.
    if (fragmentCache.has(number)) return fragmentCache.get(number);
    let fragments;
    if (!data.hasText) fragments = [{ start: 0, end: 0, text: '', kind: 'scan' }];
    else {
      const chapter = currentChapter(number);
      const paragraphs = source && chapter.page === number ? removeRepeatedChapterHeading(data.paragraphs, chapter.title) : data.paragraphs;
      const text = data.layout?.projection.text ?? paragraphs.join('\n\n');
      const bounds = $('book-spread').getBoundingClientRect();
      const host = el('div', 'book-measure');
      host.setAttribute('aria-hidden', 'true'); host.inert = true;
      host.style.width = `${bounds.width / (smallScreen.matches ? 1 : 2)}px`;
      host.style.height = `${bounds.height}px`;
      const first = paperPage(number, 'left');
      const continuation = paperPage(number, 'left', 1);
      host.append(first, continuation);
      document.body.append(host);
      const fittingStarted = performance.now();
      readerMetric('fitting-start', { page: number });
      try {
        const fits = (slice, { start, end }) => {
          check();
          const page = start === 0 ? first : continuation;
          const began = performance.now();
          fillFragment(page, { page: number, start, end, text: slice, layout: data.layout });
          const constructed = performance.now();
          const prose = page.querySelector('.page-prose');
          // Leave a pixel for rounding at the last line's lower edge.
          const last = prose.lastElementChild;
          const heightFits = prose.scrollHeight <= prose.clientHeight;
          const result = heightFits && (!last || last.getBoundingClientRect().bottom <= prose.getBoundingClientRect().bottom - 1);
          readerMetric('fit-probe', { page: number, start, end, fits: result, construction: constructed - began,
            layout: performance.now() - constructed, reads: heightFits && last ? 4 : 2 });
          return result;
        };
        const steps = data.layout ? paginateLayoutSteps(data.layout, { signal }) : paginateTextSteps(text, { signal });
        fragments = await fitPageSteps(steps, fits, check, signal);
      } finally { host.remove(); readerMetric('fitting-end', { page: number, aborted: signal.aborted, duration: performance.now() - fittingStarted }); }
    }
    check();
    const characters = fragments.at(-1)?.end || 0;
    if (characters <= fragmentCharacterBudget) {
      while (fragmentCache.size >= 6 || fragmentCharacters + characters > fragmentCharacterBudget) {
        const oldest = fragmentCache.keys().next().value;
        fragmentCharacters -= fragmentCache.get(oldest).at(-1)?.end || 0;
        fragmentCache.delete(oldest);
      }
      fragmentCache.set(number, fragments); fragmentCharacters += characters;
      readerMetric('fragment-cache', { pages: fragmentCache.size, characters: fragmentCharacters });
    }
    return fragments;
  };
  return createBookPager({ count: pageCount(), loadFragments: number => {
    // A yielded fit may be requested by warmup and a foreground turn together.
    // Share it so only one owner publishes this page's cache accounting.
    if (!pending.has(number)) pending.set(number, load(number).finally(() => pending.delete(number)));
    return pending.get(number);
  } });
}
function createSpreadPreparation(context) {
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const pager = fittedPager({ ...context, signal });
  return { pager, signal, controller, context, buffer: createSpreadBuffer({ prepare: async anchor => {
    const spread = await pager.spread(anchor, step());
    if (signal.aborted || context.renderEpoch !== epoch) throw new DOMException('Reading layout changed.', 'AbortError');
    const pages = await spreadPages(spread, { ...context, signal });
    if (signal.aborted || context.renderEpoch !== epoch) throw new DOMException('Reading layout changed.', 'AbortError');
    return { spread, pages };
  } }) };
}
function readingAnchor() {
  const place = book.bookPosition;
  return { page: book.page, offset: place?.page === book.page && Number.isFinite(place.offset) ? Math.max(0, place.offset) : 0 };
}
async function spreadPages(spread, context) {
  const started = performance.now();
  const pages = await Promise.all(spread.leaves.map(async (fragment, i) => {
    const page = paperPage(fragment.page, i === 0 ? 'left' : 'right', fragment.start);
    page.dataset.textEnd = fragment.end;
    if (fragment.kind === 'scan') await fillScannedPage(fragment.page, page, context);
    else fillFragment(page, fragment);
    return page;
  }));
  if (!smallScreen.matches && pages.length < 2) pages.push(paperPage(pageCount() + 1, 'right'));
  readerMetric('spread-dom', { duration: performance.now() - started });
  return pages;
}
function commitSpread(spread, pages, place = spread.anchor) {
  fittedSpread = spread;
  book.page = spread.anchor.page;
  // Rewrapping changes the visible leaf's start, but must not move the saved
  // text anchor backward on every font, window or focus change.
  const sourceEnd = fragmentCache.get(book.page)?.at(-1)?.end ?? spread.leaves.filter(leaf => leaf.page === book.page).at(-1)?.end ?? 0;
  const offset = place.page === book.page ? Math.min(place.offset, sourceEnd) : spread.anchor.offset;
  const pageLayout = spread.leaves[0]?.layout;
  book.bookPosition = pageLayout ? readingPosition(pageLayout, book.page, offset, place) : { page: book.page, offset };
  if (contentsNodes().some(node => node.id === selectedStructureId && node.page === book.page)) book.bookPosition.contentsId = selectedStructureId;
  book.scrollPosition = { page: book.page, fraction: 0, view: mode };
  const started = performance.now();
  $('book-spread').replaceChildren(...pages);
  readerMetric('visible-insertion', { duration: performance.now() - started, page: book.page, offset });
  spreadPreparation?.buffer.remember(spread.anchor, { spread, pages });
  readerMetric('spread-cache', { entries: spreadPreparation?.buffer.size, nodes: spreadPreparation?.buffer.nodeCount });
  updateReadingPosition();
}
async function render() {
  interruptedRender = false;
  stopReadingRender();
  if (mode === 'book' && hasNoReadableText()) mode = 'original';
  const renderEpoch = ++epoch;
  const source = pdf;
  fittedSpread = null;
  fragmentCache.clear();
  fragmentCharacters = 0;
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
    const restorePosition = { ...book.bookPosition };
    const previous = book.scrollPosition;
    const fraction = previous?.page === book.page && previous.view === mode ? previous.fraction : 0;
    scroller = createPageScroller($('scroll-stage'), {
      count: pageCount(), initialPage: book.page, initialFraction: fraction,
      estimateHeight: mode === 'original' ? 800 : smallScreen.matches ? 500 : 620,
      maxMounted: mode === 'original' ? 4 : 7, overscan: mode === 'original' ? 1 : 2, maxConcurrent: 2,
      createPage: number => mode === 'original' ? originalScrollPage(number) : paperPage(number, 'scroll'),
      loadPage: async (number, page, { signal }) => {
        if (mode === 'original') await fillOriginalPage(number, page, { signal, renderEpoch, source });
        else {
          await fillPaperPage(number, page, { signal, renderEpoch, source });
          if (!signal.aborted && renderEpoch === epoch && restorePosition.page === number
            && (restorePosition.source || restorePosition.offset > 0 || Number.isFinite(restorePosition.offset) && restorePosition.layoutVersion !== LAYOUT_VERSION)) {
            const data = await pageText(number, source);
            const mapped = resolveReadingPosition(data, restorePosition, currentChapter(number).title);
            if (!signal.aborted && renderEpoch === epoch) {
              book.bookPosition = mapped;
              requestAnimationFrame(() => { if (renderEpoch === epoch) restoreScrollAnchor(mapped); });
            }
          }
        }
      },
      onPosition: position => {
        if (renderEpoch !== epoch) return;
        const changed = book.page !== position.page;
        book.page = position.page;
        if (mode === 'book') {
          const sourcePlace = captureScrollAnchor(position.page);
          book.bookPosition = sourcePlace ?? (book.bookPosition?.page === position.page ? book.bookPosition : { page: position.page, offset: 0, layoutVersion: LAYOUT_VERSION });
          if (contentsNodes().some(node => node.id === selectedStructureId && node.page === position.page)) book.bookPosition.contentsId = selectedStructureId;
        }
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
  const preparation = createSpreadPreparation({ signal, renderEpoch, source });
  spreadPreparation = preparation;
  pageFillPromise = (async () => {
    try {
      let anchor = readingAnchor();
      if (source) {
        const data = await pageText(anchor.page, source);
        if (signal.aborted || renderEpoch !== epoch) return;
        const place = book.bookPosition?.page === anchor.page ? book.bookPosition : null;
        anchor = resolveReadingPosition(data, { ...place, ...anchor, ...(!place ? { layoutVersion: LAYOUT_VERSION } : {}) }, currentChapter(anchor.page).title);
        book.bookPosition = anchor;
      }
      const { spread, pages } = await preparation.buffer.get(anchor);
      if (signal.aborted || renderEpoch !== epoch) return;
      commitSpread(spread, pages, anchor);
      if (!starting) persist();
    } catch (error) {
      if (error.name !== 'AbortError' && renderEpoch === epoch) toast('That page needs another try. Choose a page or reopen the book.');
    } finally {
      if (renderEpoch === epoch) { $('book-spread').setAttribute('aria-busy', 'false'); updateControls(); }
    }
  })();
  await pageFillPromise;
  if (preparation === spreadPreparation) warmSpreads();
}
async function flipTo(direction) {
  if (turnController) {
    // One pending direction preserves a deliberate second press. Saturated
    // bursts coalesce to the latest direction instead of building a repeat queue.
    pendingTurn = direction;
    readerMetric('turn-pending', { direction });
    return;
  }
  if (!fittedSpread) return;
  stopSpreadWarmup();
  const controller = new AbortController();
  turnController = controller;
  let resolveTurn;
  turnCompletion = new Promise(resolve => { resolveTurn = resolve; });
  const renderEpoch = epoch;
  const started = performance.now();
  // A change during spread preparation applies to the next turn.
  const duration = pageTurnSpeed.duration;
  readerMetric('turn-start', { direction });
  const fromAnchor = fittedSpread.anchor;
  const stage = $('book-spread');
  let committed = false;
  stage.setAttribute('aria-busy', 'true');
  updateControls();
  try {
    await pageFillPromise;
    const preparation = spreadPreparation;
    if (!preparation || controller.signal.aborted) return;
    const pager = preparation.pager;
    const target = direction === 'next' ? fittedSpread.next : await pager.previous(fromAnchor, step());
    if (!target || (target.page === fromAnchor.page && target.offset === fromAnchor.offset)) return;
    const { spread, pages } = await preparation.buffer.get(target);
    if (controller.signal.aborted || renderEpoch !== epoch) return;
    const animationStarted = performance.now();
    // Fallback-only spreads need their recovery content, not a decorative wait.
    const fallbackOnly = value => value.leaves.every(leaf => ['scan', 'error', 'overflow'].includes(leaf.kind));
    const fallback = fallbackOnly(fittedSpread) && fallbackOnly(spread);
    readerMetric('turn-ready', { preparation: animationStarted - started, page: spread.anchor.page, offset: spread.anchor.offset, fallback });
    const releaseFitting = fitGate.pause();
    let result;
    try {
      result = await turnPages({ stage, targetPages: pages, direction: direction === 'next' ? 'forward' : 'backward', singlePage: smallScreen.matches, signal: controller.signal,
        reducedMotion: reducedMotion.matches || fallback || finishTurnsForLayout, duration });
    } finally {
      releaseFitting();
    }
    readerMetric('turn-animation', { duration: performance.now() - animationStarted, result });
    if (result !== 'finished' || controller.signal.aborted || renderEpoch !== epoch) return;
    // Only a completed turn changes the book or its saved source-page anchor.
    commitSpread(spread, pages);
    committed = true;
    readerMetric('turn-commit', { duration: performance.now() - started, page: spread.anchor.page, offset: spread.anchor.offset });
    persist();
  } catch {
    if (!controller.signal.aborted && renderEpoch === epoch) toast('That page needs another try. Use Next or choose its page number.');
  } finally {
    if (turnController === controller) {
      turnController = null;
      const nextDirection = committed ? pendingTurn : null;
      pendingTurn = null;
      stage.setAttribute('aria-busy', 'false');
      updateControls();
      if (nextDirection) flipTo(nextDirection);
      else warmSpreads();
    }
    resolveTurn();
  }
}

// Focus changes presentation, not navigation intent. Finish a turn before the
// geometry changes; direct jumps, modal opens and visibility changes still cancel.
async function settlePageTurnForLayout() {
  if (!turnController) return;
  finishTurnsForLayout = true;
  try {
    while (turnController) {
      const completed = turnCompletion;
      for (const animation of $('book-spread').querySelector('.page-turn-leaf')?.getAnimations() || []) {
        try { animation.finish(); } catch { /* preparation or cancellation may already own it */ }
      }
      await completed;
    }
  } finally {
    finishTurnsForLayout = false;
  }
}
function navigate(number) {
  if (!Number.isInteger(number) || number < 1 || number > pageCount()) return toast(`Choose a page from 1 to ${pageCount()}.`);
  cancelPageTurn();
  ++structureNavigationEpoch; selectedStructureId = null;
  book.page = number;
  // Original navigation has no text offset and must not erase the last Book anchor.
  if (mode === 'book') book.bookPosition = { page: number, offset: 0, layoutVersion: LAYOUT_VERSION };
  book.scrollPosition = { page: number, fraction: 0, view: mode };
  if (layout === 'scroll' && scroller) {
    scroller.jumpTo(number, { behavior: 'auto' });
    updateReadingPosition();
  } else render();
  persist();
}
function turn(direction) {
  readerMetric('turn-input', { direction, busy: Boolean(turnController) });
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
  if (value === 'book' && hasNoReadableText()) value = 'original';
  if (mode === value) return;
  flushScrollSave(); mode = value; render();
  persist({ view: mode });
}
function setLayout(value) {
  if (layout === value) return;
  flushScrollSave(); layout = value; savePreference('reading-layout', layout); render();
  persist({ readingLayout: layout });
}
$('book-view').addEventListener('click', () => setMode('book'));
$('original-view').addEventListener('click', () => { if (pdf) setMode('original'); });
$('text-help-button').addEventListener('click', () => {
  if (!pdf) return;
  const content = el('div');
  content.append(el('p', 'modal-copy', 'Book view uses the text stored inside the PDF. That text can contain OCR or encoding mistakes even when the visible page looks correct.'),
    el('p', 'modal-copy', 'Compare this source page in Original PDF, or keep reading there. Folio does not guess replacement words or run OCR. The original PDF stays unchanged.'),
    el('p', 'inline-note', 'Use Book view to return to your text position on this source page. Both views support Scroll.'));
  const original = button('Use Original PDF', 'secondary-button', () => {
    $('modal').close();
    // Switching views preserves the last Book anchor; a page jump would erase it.
    setMode('original');
  });
  original.id = 'use-original-button';
  content.append(actions(original));
  showModal('When the text looks wrong', content);
});
['pages', 'scroll'].forEach(value => $(`${value}-layout`).addEventListener('click', () => setLayout(value)));
smallScreen.addEventListener('change', () => { flushScrollSave(); render(); });
window.addEventListener('resize', async () => {
  // Native fullscreen changes viewport geometry; do not discard its pending turn.
  if (immersiveFocus.transitioning) await settlePageTurnForLayout();
  else cancelPageTurn();
  clearTimeout(resizeTimer); resizeTimer = null;
  if (layout === 'pages' && mode === 'book') resizeTimer = setTimeout(() => { resizeTimer = null; render(); }, 160);
}, { passive: true });
reducedMotion.addEventListener('change', cancelPageTurn);
let swipeStart = null;
$('book-spread').addEventListener('pointerdown', event => {
  if (layout !== 'pages' || mode !== 'book' || !['touch', 'pen'].includes(event.pointerType) || event.target.closest('button, input, a')) return;
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
$('bookmark-button').addEventListener('click', async () => {
  const target = book;
  const page = target.page;
  const previous = target.bookmarks;
  const present = !previous.includes(page);
  const optimistic = present ? [...previous, page].sort((a, b) => a - b) : previous.filter(value => value !== page);
  target.bookmarks = optimistic;
  updateControls();
  if (target.id === 'demo') await persist();
  else {
    try {
      if (!bookStored) throw new Error('Book is not saved.');
      const bookmarks = await setBookBookmark(target.id, page, present, previous);
      if (target.bookmarks === optimistic) target.bookmarks = bookmarks;
      if (book === target) saved = true;
    } catch {
      if (book === target) {
        saved = false;
        updateControls();
        toast('Bookmark changed for this session. Local saving is unavailable.');
      }
      return;
    }
  }
  if (book !== target) return;
  updateControls();
  toast(present ? `Page ${page} tucked away. Find it on My shelf.` : 'Bookmark removed.');
});
async function toggleFocus(value = !document.body.classList.contains('focus-mode')) {
  await settlePageTurnForLayout();
  closeContents();
  const focus = Boolean(value);
  document.body.classList.toggle('focus-mode', focus);
  $('contents-toggle').hidden = focus;
  $('focus-button').setAttribute('aria-label', focus ? 'Leave focus mode' : 'Enter focus mode');
  $('focus-button').setAttribute('aria-pressed', String(focus));
  $('focus-button').title = focus ? 'Leave focus mode (F or Escape)' : 'Focus mode (F)';
  document.dispatchEvent(new CustomEvent('reader-focus-change', { detail: { focus } }));
  scroller?.reflow();
  if (mode === 'book' && layout === 'pages') render();
}
const immersiveFocus = attachImmersiveFocus({
  beforeChange: settlePageTurnForLayout,
  async setFocus(value) {
    await toggleFocus(value);
  },
});
$('focus-button').addEventListener('click', () => toggleFocus());
$('contents-toggle').addEventListener('click', () => {
  cancelPageTurn();
  const open = document.body.classList.toggle('contents-open');
  $('contents-toggle').setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || $('page-turn-speed-panel').contains(event.target) || $('modal').open
    || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (['ArrowRight', 'ArrowLeft'].includes(event.key)) {
    event.preventDefault();
    // Held keys never add navigation debt, including across completed turns.
    if (!event.repeat) turn(event.key === 'ArrowRight' ? 'next' : 'previous');
  }
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { cancelPageTurn(); flushScrollSave(); }
  else resumeInterruptedRender();
});
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
  catch { shelf = []; $('shelf-count').textContent = '0'; }
  renderShelfShortcut();
}
function renderShelfShortcut() {
  const spines = $('shelf-spines');
  spines.replaceChildren();
  // Keep the reference's little row of books, even before the first import.
  for (let index = 0; index < 8; index++) {
    const item = shelf[index];
    const spine = el(item ? 'button' : 'span', 'shelf-spine');
    const cover = el('span', 'shelf-spine-cover');
    cover.setAttribute('aria-hidden', 'true');
    spine.append(cover);
    if (item) {
      spine.type = 'button';
      spine.setAttribute('aria-label', `Read ${item.title}`);
      const tooltip = el('span', 'shelf-tooltip', item.title);
      tooltip.id = `shelf-tooltip-${index}`;
      tooltip.setAttribute('role', 'tooltip');
      spine.setAttribute('aria-describedby', tooltip.id);
      spine.append(tooltip);
      spine.addEventListener('click', () => {
        if (importing) return toast('Finish opening your PDF, or cancel, before visiting the shelf.');
        loadStored(item.id);
      });
    } else {
      spine.setAttribute('aria-hidden', 'true');
    }
    spines.append(spine);
  }
  $('library-button').setAttribute('aria-label', `View your shelf, ${shelf.length} ${shelf.length === 1 ? 'book' : 'books'}`);
}
async function importFile(file) {
  if (!file || importing) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('Choose a PDF file to add to your shelf.');
  if (file.size > 150 * 1024 * 1024) return toast('This PDF is over 150 MB. Choose a smaller copy for this simple reader.');
  const controller = new AbortController();
  importing = controller;
  updateStructureTools();
  const status = loadingDialog(controller);
  let candidate;
  let installed = false;
  try {
    const bytes = await file.arrayBuffer();
    if (controller.signal.aborted) return;
    candidate = await openPdf(bytes, { signal: controller.signal, onPassword: (updatePassword, reason) => askPassword(updatePassword, reason, controller) });
    if (controller.signal.aborted) return;
    modalCleanup = null;
    status.message.textContent = 'Reading the PDF’s contents…';
    const structure = await readDocumentStructure(candidate, { signal: controller.signal });
    if (controller.signal.aborted) return;
    const nextBook = { id: crypto.randomUUID(), title: titleFromFilename(file.name), filename: file.name, bytes, structure,
      contentsExpanded: {}, chapters: chaptersFromNodes(structure.nodes), source: 'structure', scannedPages: 0, page: 1,
      view: 'book', readingLayout: layout, bookmarks: [], addedAt: Date.now() };
    try { await putBook(nextBook); saved = true; bookStored = true; }
    catch { saved = false; bookStored = false; toast('Your PDF is open, but the shelf could not save it. Keep the source file and choose it again next time.'); }
    flushScrollSave(); stopStructureScan(); stopReadingRender(); ++epoch; selectedStructureId = null;
    await disposePdf(pdf);
    pdf = candidate; candidate = null; book = nextBook; mode = 'book'; pageCache.clear();
    installed = true;
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
    if (installed) maybeScanStructure();
    // Completed books do not start a scan that would otherwise refresh controls.
    updateStructureTools();
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
  let installed = false;
  const controller = new AbortController();
  importing = controller;
  updateStructureTools();
  loadingDialog(controller);
  try {
    const stored = await getBook(id);
    if (!stored) throw new Error('This book is no longer on your shelf.');
    candidate = await openPdf(stored.bytes, { signal: controller.signal, onPassword: (updatePassword, reason) => askPassword(updatePassword, reason, controller) });
    if (controller.signal.aborted) return;
    flushScrollSave(); stopStructureScan(); stopReadingRender(); ++epoch; selectedStructureId = null;
    await disposePdf(pdf);
    pdf = candidate; candidate = null; book = stored;
    installed = true;
    book.page = Math.min(pdf.numPages, Math.max(1, page || book.page || 1));
    mode = (stored.view ?? stored.scrollPosition?.view) === 'original' ? 'original' : 'book';
    const hasStoredLayout = ['pages', 'scroll'].includes(stored.readingLayout);
    if (hasStoredLayout) layout = stored.readingLayout;
    selectedStructureId = !page && stored.bookPosition?.page === book.page ? stored.bookPosition.contentsId || null : null;
    if (page) {
      book.scrollPosition = { page: book.page, fraction: 0, view: mode };
      if (mode === 'book') book.bookPosition = { page: book.page, offset: 0 };
    }
    pageCache.clear(); saved = true; bookStored = true;
    modalCleanup = null; $('modal').close();
    render();
    persist(undefined, { view: mode, readingLayout: layout, bookmarks: book.bookmarks });
  } catch (error) { if (!controller.signal.aborted) importError(error); }
  finally {
    await disposePdf(candidate);
    importing = null;
    if ($('modal').open) { modalCleanup = null; $('modal').close(); }
    if (installed) maybeScanStructure();
    updateStructureTools();
  }
}
async function useDemo() {
  flushScrollSave(); stopStructureScan(); stopReadingRender(); ++epoch; selectedStructureId = null;
  await disposePdf(pdf); pdf = null; mode = 'book'; book = structuredClone(demo); pageCache.clear(); bookStored = true;
  const position = preference('demo', { page: 1, bookmarks: [] });
  book.page = Math.min(8, Math.max(1, position.page)); book.bookmarks = position.bookmarks || [];
  book.scrollPosition = position.scrollPosition;
  book.bookPosition = position.bookPosition;
  if (['pages', 'scroll'].includes(position.readingLayout)) layout = position.readingLayout;
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
    const count = item.structure ? structureNodes(item.structure, item.structure.totalPages).length : item.chapters.length;
    info.append(el('h3', '', item.title), el('p', 'inline-note', `Last read: page ${item.page} · ${count} contents entries`));
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

// A normal reload resumes its checkpoint. Only the explicit Stop action pauses it.
window.addEventListener('pagehide', () => { stopStructureScan(); });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
$('launch-help').addEventListener('click', () => {
  if (importing) return;
  const content = el('div');
  if (location.protocol === 'folio:') {
    content.append(el('p', 'modal-copy', 'Open Folio whenever you want a little room to read. No browser, local server, or internet connection is needed.'));
    content.append(el('p', 'modal-copy', 'Your PDFs, bookmarks, and reading positions stay in Folio on this computer, even when you close the window. Keep your original PDFs as a backup.'));
    content.append(el('p', 'inline-note', 'The desktop app has its own shelf. To read books from the Chrome version here, open the original PDF files in Folio.'));
    showModal('Your own reading corner', content);
    return;
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    content.append(el('p', 'modal-copy', 'Keep your reading room close at hand.'));
    const list = el('ol', 'modal-copy');
    ['Double-click “Start Folio.cmd” in the app folder. It starts the local reader and opens Chrome.', 'Run “Create shortcut.cmd” once to put a Folio launcher on your Desktop. It starts the server for you each time.', 'In Chrome, you can also bookmark this page or install Folio from the browser menu when available.'].forEach(text => list.append(el('li', '', text)));
    content.append(list, el('p', 'inline-note', 'The Desktop launcher needs this app folder and Node.js. An installed Chrome app needs the local server or its saved offline cache. Your books stay in the same Chrome profile.'));
  } else {
    content.append(el('p', 'modal-copy', 'Bookmark this website to return to your reading room. You can also install Folio from the browser menu when that option is available.'));
    content.append(el('p', 'inline-note', 'Your PDFs, bookmarks, and reading positions are saved in this browser profile for this website. A different address, browser profile, or the desktop app has its own shelf. Keep your original PDFs as a backup.'));
  }
  if (installPrompt) content.append(button('Install Folio in Chrome', 'primary-button', async () => { await installPrompt.prompt(); installPrompt = null; $('modal').close(); }));
  showModal('Your own reading corner', content);
});

async function start() {
  const active = preference('active-book', 'demo');
  const position = preference('demo', { page: 1, bookmarks: [] });
  book.page = Math.min(8, Math.max(1, position.page || 1)); book.bookmarks = position.bookmarks || [];
  book.scrollPosition = position.scrollPosition;
  book.bookPosition = position.bookPosition;
  if (active === 'demo' && ['pages', 'scroll'].includes(position.readingLayout)) layout = position.readingLayout;
  await render();
  await refreshShelf();
  if (active !== 'demo' && shelf.some(item => item.id === active)) await loadStored(active);
  starting = false;
  if (import.meta.env.PROD && ['http:', 'https:'].includes(location.protocol) && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
start();
