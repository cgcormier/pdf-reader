import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectChapters,
  extractPage,
  renderPdfPage,
  titleFromFilename,
} from '../src/pdf-engine.js';

function textItem(str, x, y, { size = 10, width = str.length * size * 0.5 } = {}) {
  return { str, width, transform: [size, 0, 0, size, x, y], hasEOL: false };
}

function makePdf({ count = 1, outlines = [], pageContent = () => ({ items: [] }), indexForRef = new Map() } = {}) {
  return {
    numPages: count,
    getOutline: async () => outlines,
    getDestination: async (name) => name === 'missing' ? null : name,
    getPageIndex: async (ref) => {
      if (!indexForRef.has(ref)) throw new Error('unknown ref');
      return indexForRef.get(ref);
    },
    getPage: async (pageNumber) => ({
      view: [0, 0, 600, 800],
      getTextContent: async () => pageContent(pageNumber),
      getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
      render: ({ canvasContext, viewport }) => ({ promise: Promise.resolve({ canvasContext, viewport }) }),
    }),
  };
}

function deferredForEngineTest() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

test('outline resolves named, reference, and integer destinations; drops invalid pages and deduplicates', async () => {
  const ref = { num: 4, gen: 0 };
  const pdf = makePdf({
    count: 6,
    outlines: [
      { title: 'Later', dest: 'chapter-later' },
      { title: 'Start', dest: [ref] },
      { title: 'Duplicate', dest: [2] },
      { title: 'Missing', dest: 'missing' },
      { title: 'Out of bounds', dest: [7] },
    ],
    indexForRef: new Map([[ref, 0]]),
  });
  // Named destinations resolve to a zero-based page reference.
  pdf.getDestination = async (name) => name === 'chapter-later' ? [3] : null;
  const result = await detectChapters(pdf);
  assert.deepEqual(result, {
    chapters: [
      { title: 'Start', page: 1 },
      { title: 'Duplicate', page: 3 },
      { title: 'Later', page: 4 },
    ],
    source: 'outline',
    scannedPages: 0,
  });
});

test('outline without a destination descends to usable children and prefixes Beginning', async () => {
  const pdf = makePdf({
    count: 8,
    outlines: [{ title: 'Section group', dest: null, items: [{ title: 'Chapter Four', dest: [3] }] }],
  });
  const result = await detectChapters(pdf);
  assert.deepEqual(result.chapters, [
    { title: 'Beginning', page: 1 },
    { title: 'Chapter Four', page: 4 },
  ]);
  assert.equal(result.source, 'outline');
});

test('unreadable outline destinations fall back to explicit headings', async () => {
  const pdf = makePdf({
    count: 3,
    outlines: [{ title: 'Broken', dest: [null] }],
    pageContent: (page) => page === 2 ? { items: [
      textItem('Chapter 2: The Return', 40, 720, { size: 20 }),
      textItem('The story continues.', 40, 680, { size: 10 }),
    ] } : { items: [] },
  });
  const result = await detectChapters(pdf);
  assert.deepEqual(result.chapters, [
    { title: 'Beginning', page: 1 },
    { title: 'Chapter 2: The Return', page: 2 },
  ]);
  assert.equal(result.source, 'headings');
  assert.equal(result.scannedPages, 3);
});

test('heading scan is bounded to 120 pages and reports progress', async () => {
  let fetched = 0;
  const progress = [];
  const pdf = makePdf({
    count: 140,
    pageContent: (page) => {
      fetched += 1;
      return page === 1 ? { items: [textItem('Chapter 1: Start', 30, 720, { size: 18 })] } : { items: [] };
    },
  });
  const result = await detectChapters(pdf, { onProgress: (current, total) => progress.push([current, total]) });
  assert.equal(fetched, 120);
  assert.equal(result.scannedPages, 120);
  assert.deepEqual(progress[0], [1, 120]);
  assert.deepEqual(progress.at(-1), [120, 120]);
});

test('table-of-contents entries and numeric body examples do not become chapters', async () => {
  const pdf = makePdf({
    count: 2,
    pageContent: (page) => page === 1 ? { items: [
      textItem('Chapter 1 ........ 4', 30, 720),
      textItem('Chapter 2 ........ 9', 30, 700),
    ] } : { items: [
      textItem('For example, chapter 2 describes the result.', 30, 720),
      textItem('Chapter 2 is a useful value in this example.', 30, 700),
    ] },
  });
  const result = await detectChapters(pdf);
  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.chapters, [{ title: 'Entire book', page: 1 }]);
});

test('heading scan accepts spelled numbers and bare numeric or Roman headings with title lines', async () => {
  const pages = new Map([
    [1, { items: [
      textItem('CHAPTER ONE: The Dawn', 30, 720, { size: 20 }),
      textItem('A short opening.', 30, 680, { size: 10 }),
    ] }],
    [2, { items: [
      textItem('Chapter 2', 30, 720, { size: 20 }),
      textItem('The Return', 30, 695, { size: 20 }),
      textItem('The story continues.', 30, 660, { size: 10 }),
    ] }],
    [3, { items: [
      textItem('Chapter I', 30, 720, { size: 20 }),
      textItem('The First Trial', 30, 695, { size: 20 }),
      textItem('The story begins.', 30, 660, { size: 10 }),
    ] }],
    [4, { items: [
      textItem('Chapter Twenty: The Last', 30, 720, { size: 20 }),
      textItem('A final section.', 30, 680, { size: 10 }),
    ] }],
  ]);
  const pdf = makePdf({ count: 4, pageContent: (page) => pages.get(page) });
  const result = await detectChapters(pdf);
  assert.deepEqual(result.chapters, [
    { title: 'Chapter One: The Dawn', page: 1 },
    { title: 'Chapter 2: The Return', page: 2 },
    { title: 'Chapter I: The First Trial', page: 3 },
    { title: 'Chapter Twenty: The Last', page: 4 },
  ]);
  assert.equal(result.source, 'headings');
});

test('bare headings without a prominent title and single-entry contents pages are ignored', async () => {
  const pdf = makePdf({
    count: 2,
    pageContent: (page) => page === 1 ? { items: [
      textItem('Contents', 30, 750, { size: 18 }),
      textItem('Chapter One', 30, 720, { size: 10 }),
      textItem('Introduction', 30, 700, { size: 10 }),
    ] } : { items: [
      textItem('Chapter II', 30, 400, { size: 10 }),
      textItem('A passing reference', 30, 350, { size: 10 }),
    ] },
  });
  const result = await detectChapters(pdf);
  assert.deepEqual(result.chapters, [{ title: 'Entire book', page: 1 }]);
  assert.equal(result.source, 'fallback');
});

test('extractPage orders text by page position, rebuilds paragraphs, and handles scanned pages', async () => {
  const pdf = makePdf({
    count: 2,
    pageContent: (page) => page === 1 ? { items: [
      textItem('second', 80, 700),
      textItem('first', 30, 700),
      textItem('continued', 30, 685),
      textItem('new paragraph', 30, 650),
      textItem('1', 300, 20),
    ] } : { items: [] },
  });
  assert.deepEqual(await extractPage(pdf, 1), {
    paragraphs: ['first second continued', 'new paragraph'],
    hasText: true,
  });
  assert.deepEqual(await extractPage(pdf, 2), { paragraphs: [], hasText: false });
  await assert.rejects(extractPage(pdf, 0), RangeError);
});

test('filename title is sanitized and has an empty-name fallback', () => {
  assert.equal(titleFromFilename('C:\\books\\A_Good  Book.PDF'), 'A Good Book');
  assert.equal(titleFromFilename(''), 'Untitled book');
});

test('renderPdfPage sizes the canvas and waits for rendering', async () => {
  let rendered = false;
  const pdf = makePdf();
  const page = await pdf.getPage(1);
  page.render = () => ({ promise: new Promise((resolve) => setTimeout(() => { rendered = true; resolve(); }, 0)) });
  pdf.getPage = async () => page;
  const canvas = { getContext: () => ({}) };
  const viewport = await renderPdfPage(pdf, 1, canvas, { scale: 1.25 });
  assert.deepEqual([canvas.width, canvas.height], [750, 1000]);
  assert.deepEqual([viewport.width, viewport.height], [750, 1000]);
  assert.equal(rendered, true);
});

test('renderPdfPage caps canvas pixels while preserving page proportions', async () => {
  const pdf = makePdf();
  const canvas = { getContext: () => ({}) };
  const viewport = await renderPdfPage(pdf, 1, canvas, { scale: 2, maxPixels: 100_000 });
  assert.ok(canvas.width * canvas.height <= 100_000);
  assert.ok(Math.abs(canvas.width / canvas.height - 0.75) < 0.002);
  assert.ok(Math.abs(viewport.width / viewport.height - 0.75) < 0.002);
});

test('renderPdfPage cancels an active render when its signal aborts', async () => {
  const pdf = makePdf();
  const controller = new AbortController();
  let cancelCalls = 0;
  let rejectRender;
  const page = await pdf.getPage(1);
  page.render = () => ({
    promise: new Promise((resolve, reject) => { rejectRender = reject; }),
    cancel() {
      cancelCalls += 1;
      rejectRender(new Error('render cancelled'));
    },
  });
  pdf.getPage = async () => page;
  const pending = renderPdfPage(pdf, 1, { getContext: () => ({}) }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, /render cancelled/);
  assert.equal(cancelCalls, 1);
});

test('renderPdfPage checks abort after waiting for page data', async () => {
  const pdf = makePdf();
  const controller = new AbortController();
  let rendered = false;
  const pageReady = deferredForEngineTest();
  pdf.getPage = () => pageReady.promise;
  const pending = renderPdfPage(pdf, 1, { getContext: () => ({}) }, { signal: controller.signal });
  controller.abort();
  pageReady.resolve({
    getViewport: () => ({ width: 20, height: 20 }),
    render() { rendered = true; return { promise: Promise.resolve() }; },
  });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(rendered, false);
});

test('detectChapters rejects promptly when its signal is aborted', async () => {
  const controller = new AbortController();
  const pdf = makePdf({ count: 2 });
  pdf.getOutline = () => new Promise(() => {});
  const pending = detectChapters(pdf, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
