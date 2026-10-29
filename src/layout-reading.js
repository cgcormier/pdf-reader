import { LAYOUT_VERSION, layoutSlice, sourceAt, offsetForSource, resolveSource } from './pdf-layout.js';
import { removeRepeatedChapterHeading } from './book-layout.js';
import { paginateTextSteps, runPaginationSteps } from './book-pagination.js';
import { chapterNumber } from './document-structure.js';

const renderIndexes = new WeakMap();
function renderIndex(layout) {
  if (!renderIndexes.has(layout)) {
    const speakers = new Map();
    for (const block of layout.blocks) if (block.association && block.speaker && !speakers.has(block.association)) speakers.set(block.association, block);
    renderIndexes.set(layout, { speakers, regions: new Map(layout.regions.map(region => [region.id, region])) });
  }
  return renderIndexes.get(layout);
}

/** Prefer a source chapter title over an injected copy without changing offsets. */
export function hasSourceChapterTitle(layout, title) {
  const key = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const subtitle = value => value.replace(/^(?:chapter|part|book|section|appendix)\s+\S+\s*[:.–—-]\s*/i, '');
  const needle = key(title);
  if (!needle) return false;
  // A confirmed mid-page heading belongs at its source position, not at the
  // start of that PDF page just because chapter navigation is page-based.
  if (layout.blocks.some(block => {
    if (block.role !== 'heading') return false;
    const text = layout.projection.text.slice(block.start, block.end);
    // An outline may name just the subtitle of a numbered source heading.
    const sourceNumber = chapterNumber(text); const targetNumber = chapterNumber(title);
    return key(text) === needle || key(subtitle(text)) === needle
      || sourceNumber && sourceNumber === targetNumber && key(subtitle(text)) === key(subtitle(title));
  })) return true;
  let previous;
  let previousBlock;
  for (const block of layout.blocks.slice(0, 4)) {
    const line = block.lines[0];
    const text = layout.projection.text.slice(block.start, block.end);
    // A later body mention cannot suppress the intro. Only a compact cluster
    // of standalone opening lines can corroborate an imperfectly classified title.
    if (block.lines.length !== 1 || text.length > 110 || line.top > layout.height * .3
      || previous && line.top - previous.bottom > layout.bodySize * 5) break;
    if (key(text) === needle) return true;
    // Contents may combine a number heading and its separate source subtitle.
    if (previousBlock?.role === 'heading'
      && key(layout.projection.text.slice(previousBlock.start, previousBlock.end) + text) === needle) return true;
    if (/[.!?]$/.test(text) && block.role !== 'heading') break;
    previous = line; previousBlock = block;
  }
  return false;
}

/** Resolve an unversioned offset through its original, heading-dependent text. */
export function resolveReadingPosition(data, position, chapterTitle = '') {
  if (!data.layout) return { ...position };
  const projection = data.layout.projection;
  if (position?.source && position.layoutVersion === LAYOUT_VERSION) {
    return { ...position, offset: offsetForSource(projection, position.source) };
  }
  if (position?.layoutVersion === LAYOUT_VERSION) return { ...position, offset: Math.min(projection.text.length, Math.max(0, position.offset || 0)) };
  const oldOffset = Math.max(0, position?.offset || 0);
  const oldParagraphs = data.legacy.text.split('\n\n');
  const retained = chapterTitle ? removeRepeatedChapterHeading(oldParagraphs, chapterTitle) : oldParagraphs;
  const removed = oldParagraphs.length !== retained.length ? oldParagraphs[0].length + 2 : 0;
  const source = sourceAt(data.legacy, oldOffset + removed);
  const resolved = resolveSource(projection, source);
  const offset = source ? resolved.offset : 0;
  return { ...position, offset,
    layoutVersion: LAYOUT_VERSION, source: sourceAt(projection, offset),
    legacyOffset: oldOffset, migration: resolved.match };
}

export function readingPosition(layout, page, offset, previous = {}) {
  return { page, offset, layoutVersion: LAYOUT_VERSION, source: sourceAt(layout.projection, offset),
    ...(previous.legacyOffset != null ? { legacyOffset: previous.legacyOffset } : {}) };
}

function* balanceLayoutTail(layout, fragments, signal) {
  if (fragments.length < 2) return;
  const first = fragments.at(-2); const last = fragments.at(-1);
  const length = last.end - first.start;
  if ((last.end - last.start) / length >= .25) return;
  const text = layout.projection.text;
  const blocks = layoutSlice(layout, first.start, last.end);
  // Rebalance only within this source page, retaining semantic line breaks and
  // chapter/section boundaries. Sparse singleton pages keep their source identity.
  if (blocks.some(block => block.role === 'heading' && block.start > first.start)) return;
  const candidates = new Set();
  for (const block of blocks) {
    candidates.add(block.start);
    if (['paragraph', 'list'].includes(block.role)) {
      const start = Math.max(first.start, block.start); const end = Math.min(first.end, block.end);
      for (const match of text.slice(start, end).matchAll(/\s+/gu)) candidates.add(start + match.index + match[0].length);
    } else for (const line of block.lines) candidates.add(line.start);
  }
  const midpoint = first.start + length / 2;
  const originalImbalance = Math.abs(first.end - midpoint);
  const boundaries = [...candidates].filter(end => end > first.start && end < first.end
    && Math.abs(end - midpoint) < originalImbalance).sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b);
  const measure = function* (fragment) {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const result = yield fragment;
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    return result;
  };
  for (const end of boundaries) {
    const speaker = blocks.findLast(block => block.speaker && block.start >= first.start && block.start < end);
    if (speaker && text.slice(speaker.start, end).trim().length <= speaker.speaker.length) continue;
    const previous = { ...first, end, text: text.slice(first.start, end) };
    const final = { ...last, start: end, text: text.slice(end, last.end) };
    // An enlarged final leaf can reject a candidate before its previous leaf
    // needs rendering. This infers nothing about nearby candidates or DOM monotonicity.
    if (!(yield* measure(final)) || !(yield* measure(previous))) continue;
    fragments.splice(fragments.length - 2, 2, previous, final);
    return;
  }
}

export function paginateLayout(layout, fits, { signal } = {}) {
  return runPaginationSteps(paginateLayoutSteps(layout, { signal }), fits, { signal });
}

export function* paginateLayoutSteps(layout, { signal } = {}) {
  const fragments = yield* paginateTextSteps(layout.projection.text, { signal });
  // Keep a label with the first word when it would otherwise end a leaf.
  for (let i = 0; i < fragments.length - 1; i++) {
    const fragment = fragments[i]; const next = fragments[i + 1];
    const block = layout.blocks.findLast(b => b.role === 'speech' && b.speaker && b.start > fragment.start && b.start < fragment.end);
    if (!block || layout.projection.text.slice(block.start, fragment.end).trim().length > block.speaker.length) continue;
    fragment.end = block.start; fragment.text = layout.projection.text.slice(fragment.start, fragment.end);
    next.start = block.start; next.text = layout.projection.text.slice(next.start, next.end);
    // Moving a prefix can make the next leaf too tall. Refit the remaining tail.
    // Suffix fitting retains absolute request ranges so the driver can reuse
    // identical measurements across speaker repair and final validation.
    const steps = paginateTextSteps(layout.projection.text.slice(next.start), { signal });
    let step = steps.next();
    while (!step.done) {
      const request = step.value;
      const result = yield { ...request, start: request.start + next.start, end: request.end + next.start };
      step = steps.next(result);
    }
    const tail = step.value;
    fragments.splice(i + 1, fragments.length, ...tail.map(f => ({ ...f, start: f.start + next.start, end: f.end + next.start })));
  }
  yield* balanceLayoutTail(layout, fragments, signal);
  const result = [];
  for (const fragment of fragments) {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const fits = yield fragment;
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    result.push({ ...fragment, layout, kind: fits ? 'layout' : 'overflow' });
  }
  return result;
}

// Styling addresses the canonical string, so a leaf cut through an emphasized
// source run retains both its text and its emphasis without shifting anchors.
function appendEmphasis(host, projection, start, end) {
  const doc = host.ownerDocument;
  const ranges = projection.emphasis ?? [];
  let low = 0; let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  let offset = start;
  for (let index = low; index < ranges.length && ranges[index].start < end; index++) {
    const range = ranges[index];
    const from = Math.max(start, range.start); const to = Math.min(end, range.end);
    if (offset < from) host.append(doc.createTextNode(projection.text.slice(offset, from)));
    let node = doc.createTextNode(projection.text.slice(from, to));
    for (const [enabled, tag, className] of [[range.italic, 'em', 'layout-emphasis-italic'], [range.bold, 'strong', 'layout-emphasis-bold']]) {
      if (!enabled) continue;
      const wrapper = doc.createElement(tag); wrapper.className = className; wrapper.append(node); node = wrapper;
    }
    host.append(node); offset = to;
  }
  if (offset < end) host.append(doc.createTextNode(projection.text.slice(offset, end)));
}

/** Render only text nodes, in canonical reading order. Shared by both views. */
export function renderLayout(host, layout, { start = 0, end = layout.projection.text.length, decorate = false } = {}) {
  const doc = host.ownerDocument;
  const { speakers, regions } = renderIndex(layout);
  for (const block of layoutSlice(layout, start, end)) {
    const preserve = !['paragraph', 'list'].includes(block.role);
    const node = doc.createElement(block.role === 'heading' ? 'h3' : preserve ? 'div' : 'p');
    node.className = `layout-block layout-${block.role}`;
    if (block.continuesToNext) node.className += ' layout-continues';
    node.dataset.blockId = block.id; node.dataset.layoutStart = Math.max(start, block.start);
    node.dataset.layoutEnd = Math.min(end, block.end);
    if (block.association) {
      node.dataset.speech = block.association; node.setAttribute('role', 'group');
      const speakerBlock = speakers.get(block.association);
      if (speakerBlock) node.setAttribute('aria-label', `Speech by ${speakerBlock.speaker}`);
    }
    node.style.textAlign = block.align;
    node.style.setProperty('--source-indent', `${Math.min(5, block.indent)}em`);
    node.style.setProperty('--first-indent', `${block.continued ? 0 : Math.min(4, block.firstIndent ?? 0)}em`);
    if (decorate && block.role === 'paragraph' && !block.continued && block.start === 0) node.classList.add('drop-cap');
    if (!preserve) appendEmphasis(node, layout.projection, Math.max(start, block.start), Math.min(end, block.end));
    else for (const [index, line] of block.lines.entries()) {
      if (index) node.append(doc.createTextNode('\n'));
      const span = doc.createElement('span'); span.className = 'layout-line';
      span.dataset.layoutStart = line.fragmentStart; span.dataset.layoutEnd = line.fragmentEnd;
      const region = regions.get(block.regionId);
      span.style.setProperty('--line-indent', `${Math.max(0, Math.min(6, (line.x - (region?.x ?? line.x)) / layout.bodySize))}em`);
      // Labels may share a source TextItem with speech. This is a conservative
      // string subdivision, not a claim of per-glyph source geometry.
      if (block.speaker && !block.continued && index === 0 && line.text.startsWith(block.speaker)) {
        const label = doc.createElement('strong'); label.className = 'layout-speaker';
        const labelEnd = line.fragmentStart + block.speaker.length;
        appendEmphasis(label, layout.projection, line.fragmentStart, labelEnd);
        span.append(label);
        appendEmphasis(span, layout.projection, labelEnd, line.fragmentEnd);
      } else appendEmphasis(span, layout.projection, line.fragmentStart, line.fragmentEnd);
      node.append(span);
    }
    host.append(node);
  }
}

/** Extras stay out of pagination's body string; all retained text is inspectable. */
export function renderAnnotations(host, layout) {
  if (!layout.annotations.length) return;
  const doc = host.ownerDocument; const details = doc.createElement('details');
  details.className = 'layout-annotations'; const summary = doc.createElement('summary');
  summary.textContent = `Source notes (${layout.annotations.length})`; details.append(summary);
  for (const annotation of layout.annotations) {
    const note = doc.createElement('p'); note.textContent = annotation.projection.text;
    note.dataset.sourceLine = annotation.associatedLine ?? ''; details.append(note);
  }
  host.append(details);
}
