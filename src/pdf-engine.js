import { readPageLayout } from './pdf-layout-adapter.js';
import { structureLines } from './pdf-layout.js';
const MAX_HEADING_SCAN_PAGES = 120;

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then((value) => {
      cleanup();
      resolve(value);
    }, (error) => {
      cleanup();
      reject(error);
    });
  });
}

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/** Open bytes with the PDF.js worker bundled by Vite. */
export async function openPdf(bytes, { onPassword, signal } = {}) {
  throwIfAborted(signal);
  const pdfjs = await withAbort(loadPdfJs(), signal);
  throwIfAborted(signal);
  // PDF.js may transfer a typed array to its worker. Give it a copy so the
  // caller's ArrayBuffer remains usable by the local library.
  const data = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    : bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes.slice(0))
      : new Uint8Array(bytes);
  const assetBase = import.meta.env?.DEV
    ? '/node_modules/pdfjs-dist/'
    : '/pdf-assets/';
  const loadingTask = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    cMapUrl: `${assetBase}cmaps/`,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    wasmUrl: `${assetBase}wasm/`,
  });

  // PDF.js calls its password callback with (updatePassword, reason).
  if (onPassword) loadingTask.onPassword = onPassword;
  if (!signal) return loadingTask.promise;

  let settled = false;
  const onAbort = () => {
    if (settled) return;
    settled = true;
    void loadingTask.destroy();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const doc = await withAbort(loadingTask.promise, signal);
    settled = true;
    return doc;
  } finally {
    settled = true;
    signal.removeEventListener('abort', onAbort);
  }
}

function cleanTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function destinationName(dest) {
  if (typeof dest === 'string') return dest;
  if (Array.isArray(dest)) return dest;
  return null;
}

async function resolveOutlinePage(pdf, rawDest) {
  let dest = destinationName(rawDest);
  if (typeof dest === 'string') {
    try {
      dest = await pdf.getDestination(dest);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(dest) || !dest.length) return null;

  const first = dest[0];
  let pageIndex;
  if (Number.isInteger(first)) {
    pageIndex = first;
  } else if (first && typeof first === 'object' && typeof pdf.getPageIndex === 'function') {
    try {
      pageIndex = await pdf.getPageIndex(first);
    } catch {
      return null;
    }
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) return null;
  return pageIndex + 1;
}

async function collectOutlineEntries(pdf, outline) {
  const entries = [];
  const visit = async (nodes) => {
    for (const node of nodes ?? []) {
      let page = null;
      if (node?.dest != null) page = await resolveOutlinePage(pdf, node.dest);
      if (page != null) {
        const title = cleanTitle(node.title);
        if (title) entries.push({ title, page });
      } else if (node?.items?.length) {
        await visit(node.items);
      }
    }
  };
  await visit(outline);
  return entries;
}

function dedupeAndSort(entries) {
  const seenPages = new Set();
  return entries
    .filter((entry) => {
      if (seenPages.has(entry.page)) return false;
      seenPages.add(entry.page);
      return true;
    })
    .sort((a, b) => a.page - b.page);
}

function prefixBeginning(chapters) {
  if (chapters.length && chapters[0].page > 1) {
    return [{ title: 'Beginning', page: 1 }, ...chapters];
  }
  return chapters;
}

function itemY(item) {
  const y = Number(item?.transform?.[5]);
  return Number.isFinite(y) ? y : 0;
}

function itemX(item) {
  const x = Number(item?.transform?.[4]);
  return Number.isFinite(x) ? x : 0;
}

function itemFontSize(item) {
  const transform = item?.transform;
  const size = transform ? Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0) : 0;
  return size || 10;
}

function pageLines(content) {
  const items = (content?.items ?? []).filter((item) => typeof item.str === 'string' && item.str.length);
  const sorted = [...items].sort((a, b) => itemY(b) - itemY(a) || itemX(a) - itemX(b));
  const lines = [];
  for (const item of sorted) {
    const y = itemY(item);
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - y) > Math.max(2, itemFontSize(item) * 0.18)) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  return lines.map((line) => {
    line.items.sort((a, b) => itemX(a) - itemX(b));
    let text = '';
    let right = null;
    for (const item of line.items) {
      const part = item.str.trim();
      if (!part) continue;
      const x = itemX(item);
      if (text && (item.hasEOL || (right != null && x - right > itemFontSize(item) * 0.18))) text += ' ';
      text += part;
      right = x + (Number(item.width) || part.length * itemFontSize(item) * 0.45);
      if (item.hasEOL) right = null;
    }
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      y: line.y,
      size: Math.max(...line.items.map(itemFontSize)),
      items: line.items,
    };
  }).filter((line) => line.text);
}

function isObviousPageFooter(line, page, view) {
  if (!/^\d{1,4}$/.test(line.text)) return false;
  if (!Array.isArray(view) || view.length < 4) return false;
  const bottom = Number(view[1]);
  const top = Number(view[3]);
  const height = top - bottom;
  // Match only a numeric footer in the bottom margin whose label matches the
  // physical source page number; other numbers are likely document content.
  return height > 0 && line.y <= bottom + height * 0.055 && Number(line.text) === page;
}

function textLinesForPage(content, page, view) {
  return pageLines(content).filter((line) => !isObviousPageFooter(line, page, view));
}

function splitParagraphs(lines) {
  const paragraphs = [];
  let current = '';
  let previous = null;
  for (const line of lines) {
    const gap = previous ? previous.y - line.y : 0;
    const threshold = previous ? Math.max(previous.size * 2, 8) : Infinity;
    if (current && gap > threshold) {
      paragraphs.push(current.trim());
      current = '';
    }
    current = current ? `${current} ${line.text}` : line.text;
    previous = line;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs;
}

/** Shared layout plus compatibility strings and a mapped legacy projection. */
export async function extractPage(pdf, pageNumber, { signal } = {}) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new RangeError(`Page number must be between 1 and ${pdf.numPages}.`);
  }
  const layout = await readPageLayout(pdf, pageNumber, { signal });
  const content = { items: layout.runs.map(run => ({ str: run.text, width: run.width, transform: run.transform, hasEOL: run.hasEOL, sourceIndex: run.index })) };
  // Retain the old projection solely for saved-position migration. It must use
  // the old ordering, footer filter, whitespace and paragraph separators.
  const legacyLines = textLinesForPage(content, pageNumber, layout.view);
  const legacyText = splitParagraphs(legacyLines).join('\n\n');
  let cursor = 0; const segments = [];
  for (const line of legacyLines) for (const item of line.items) {
    const part = item.str.trim(); if (!part) continue;
    const normalized = part.replace(/\s+/g, ' ');
    const start = legacyText.indexOf(normalized, cursor);
    if (start < 0) continue;
    let displayOffset = 0;
    for (const match of part.matchAll(/\s+|\S+/gu)) {
      const whitespace = /^\s/u.test(match[0]); const value = whitespace ? ' ' : match[0];
      const sourceStart = item.str.indexOf(part) + match.index;
      segments.push({ start: start + displayOffset, end: start + displayOffset + value.length,
        source: { item: item.sourceIndex, start: sourceStart, end: sourceStart + match[0].length },
        transform: whitespace && match[0] !== ' ' ? 'Legacy whitespace' : null });
      displayOffset += value.length;
    }
    cursor = start + normalized.length;
  }
  return { paragraphs: layout.blocks.map(block => layout.projection.text.slice(block.start, block.end)),
    hasText: layout.projection.text.length > 0 || layout.annotations.length > 0, layout,
    legacy: { text: legacyText, segments, omitted: [] } };
}

function headingMatch(text) {
  const match = text.match(/^(chapter|part|book)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,3}|[ivxlcdm]{1,12})\b(?:\s*([:.\-–—])\s*(.*)|\s+(.*))?$/i);
  if (!match) return null;
  const rest = cleanTitle(match[4] ?? match[5]);
  if (/(?:\.\s*){3,}\d{1,4}$/.test(text) || /[·…]{2,}\s*\d{1,4}$/.test(text) || /\s{2,}\d{1,4}$/.test(text)) return null;
  // In body copy, phrases such as "Chapter 2 is ..." are common. Without a
  // title delimiter, require a capitalized title after the chapter number.
  if (rest && !match[3] && !/^\p{Lu}/u.test(rest)) return null;
  const unit = /^[a-z]+$/i.test(match[2]) && !/^[ivxlcdm]+$/i.test(match[2])
    ? `${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()}`
    : match[2];
  const kind = match[1].toLowerCase();
  return { prefix: `${kind[0].toUpperCase()}${kind.slice(1)} ${unit}`, rest };
}

function likelyContentsPage(lines) {
  const explicit = lines.filter((line) => headingMatch(line.text));
  return explicit.length >= 2
    || lines.some((line) => /^(?:contents|table of contents)$/i.test(line.text))
    || lines.some((line) => /(?:\.\s*){3,}|…{2,}|·{3,}/.test(line.text));
}

function titleFromHeading(lines, index, pageMedianSize, pageView) {
  const line = lines[index];
  const parsed = headingMatch(line.text);
  if (!parsed) return null;
  // Larger-than-body type or a position near the top of the page is useful
  // evidence for a standalone heading; ordinary body references are rejected.
  const looksProminent = line.size >= pageMedianSize * 1.12;
  const pageHeight = Array.isArray(pageView) ? Number(pageView[3]) - Number(pageView[1]) : 0;
  const nearPageTop = pageHeight > 0 && line.y >= Number(pageView[3]) - pageHeight * 0.3;
  let title = parsed.rest;
  if (!title) {
    const next = lines[index + 1];
    if (!next || !next.text || headingMatch(next.text) || next.text.length > 100) return null;
    if (line.y - next.y > Math.max(line.size * 2.8, 22)) return null;
    const titleProminent = next.size >= pageMedianSize * 1.12;
    if (!looksProminent && !titleProminent && !nearPageTop) return null;
    if (!/^\p{Lu}/u.test(next.text)) return null;
    title = next.text;
  }
  if (title.length > 100 || /^\d{1,4}$/.test(title)) return null;
  if (!parsed.rest && !looksProminent && !nearPageTop) return null;
  if (parsed.rest && !matchTitleIsDelimited(line.text) && !looksProminent) return null;
  return `${parsed.prefix}: ${title}`;
}

function matchTitleIsDelimited(text) {
  return /^(?:chapter|part|book)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,3}|[ivxlcdm]{1,12})\s*[:.\-–—]/i.test(text);
}

async function detectHeadings(pdf, onProgress, signal) {
  const scannedPages = Math.min(pdf.numPages, MAX_HEADING_SCAN_PAGES);
  const chapters = [];
  for (let pageNumber = 1; pageNumber <= scannedPages; pageNumber += 1) {
    throwIfAborted(signal);
    onProgress?.(pageNumber, scannedPages);
    const layout = await readPageLayout(pdf, pageNumber, { signal });
    const page = { view: layout.view };
    const lines = structureLines(layout);
    if (likelyContentsPage(lines)) continue;
    const sizes = lines.map((line) => line.size).filter(Number.isFinite).sort((a, b) => a - b);
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
    for (let i = 0; i < lines.length; i += 1) {
      const title = titleFromHeading(lines, i, median, page.view);
      if (title) chapters.push({ title, page: pageNumber });
    }
  }
  return { chapters: prefixBeginning(dedupeAndSort(chapters)), source: 'headings', scannedPages };
}

/** Prefer usable outline entries, then conservative explicit heading scans. */
export async function detectChapters(pdf, { onProgress, signal } = {}) {
  throwIfAborted(signal);
  const work = (async () => {
    let outline = null;
    try {
      outline = await pdf.getOutline();
    } catch {
      outline = null;
    }
    throwIfAborted(signal);
    const chapters = dedupeAndSort(await collectOutlineEntries(pdf, outline));
    if (chapters.length) {
      return { chapters: prefixBeginning(chapters), source: 'outline', scannedPages: 0 };
    }
    const detected = await detectHeadings(pdf, onProgress, signal);
    return detected.chapters.length
      ? detected
      : { chapters: [{ title: 'Entire book', page: 1 }], source: 'fallback', scannedPages: detected.scannedPages };
  })();
  return withAbort(work, signal);
}

/** Render one source page to a caller-owned canvas. */
export async function renderPdfPage(pdf, pageNumber, canvas, { scale = 1.4, signal, maxPixels } = {}) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new RangeError(`Page number must be between 1 and ${pdf.numPages}.`);
  }
  throwIfAborted(signal);
  const page = await pdf.getPage(pageNumber);
  throwIfAborted(signal);

  let viewport = page.getViewport({ scale });
  let width = Math.max(1, Math.ceil(viewport.width));
  let height = Math.max(1, Math.ceil(viewport.height));
  const requestedPixelLimit = Number(maxPixels);
  const pixelLimit = Number.isFinite(requestedPixelLimit) && requestedPixelLimit > 0
    ? Math.max(1, Math.floor(requestedPixelLimit))
    : 0;
  if (pixelLimit && width * height > pixelLimit) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 42; iteration += 1) {
      const factor = (low + high) / 2;
      const candidateWidth = Math.max(1, Math.ceil(viewport.width * factor));
      const candidateHeight = Math.max(1, Math.ceil(viewport.height * factor));
      if (candidateWidth * candidateHeight <= pixelLimit) low = factor;
      else high = factor;
    }
    viewport = page.getViewport({ scale: scale * Math.max(Number.EPSILON, low) });
    width = Math.max(1, Math.ceil(viewport.width));
    height = Math.max(1, Math.ceil(viewport.height));
  }
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  throwIfAborted(signal);
  const renderTask = page.render({ canvasContext: context, viewport });
  const onAbort = () => {
    try {
      renderTask.cancel();
    } catch {
      // A task that completed as abort fired no longer needs cancellation.
    }
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfAborted(signal);
    await renderTask.promise;
    throwIfAborted(signal);
    return viewport;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Turn an uploaded filename into a human-readable book title. */
export function titleFromFilename(name) {
  const base = String(name ?? '').split(/[\\/]/).at(-1) ?? '';
  const withoutExtension = base.replace(/\.pdf$/i, '');
  const title = withoutExtension.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return title || 'Untitled book';
}
