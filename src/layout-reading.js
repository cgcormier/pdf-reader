import { LAYOUT_VERSION, layoutSlice, sourceAt, offsetForSource, resolveSource } from './pdf-layout.js';
import { removeRepeatedChapterHeading } from './book-layout.js';
import { paginateText } from './book-pagination.js';

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

export function paginateLayout(layout, fits, { signal } = {}) {
  const fragments = paginateText(layout.projection.text, fits, { signal });
  // Keep a label with the first word when it would otherwise end a leaf.
  for (let i = 0; i < fragments.length - 1; i++) {
    const fragment = fragments[i]; const next = fragments[i + 1];
    const block = layout.blocks.findLast(b => b.role === 'speech' && b.speaker && b.start > fragment.start && b.start < fragment.end);
    if (!block || layout.projection.text.slice(block.start, fragment.end).trim().length > block.speaker.length) continue;
    fragment.end = block.start; fragment.text = layout.projection.text.slice(fragment.start, fragment.end);
    next.start = block.start; next.text = layout.projection.text.slice(next.start, next.end);
    // Moving a prefix can make the next leaf too tall. Refit the remaining tail.
    const tail = paginateText(layout.projection.text.slice(next.start), (slice, range) => fits(slice, { start: range.start + next.start, end: range.end + next.start }), { signal });
    fragments.splice(i + 1, fragments.length, ...tail.map(f => ({ ...f, start: f.start + next.start, end: f.end + next.start })));
  }
  return fragments.map(fragment => ({ ...fragment, layout,
    kind: !fits(fragment.text, fragment) ? 'overflow' : 'layout' }));
}

/** Render only text nodes, in canonical reading order. Shared by both views. */
export function renderLayout(host, layout, { start = 0, end = layout.projection.text.length, decorate = false } = {}) {
  const doc = host.ownerDocument;
  for (const block of layoutSlice(layout, start, end)) {
    const preserve = !['paragraph', 'list'].includes(block.role);
    const node = doc.createElement(block.role === 'heading' ? 'h3' : preserve ? 'div' : 'p');
    node.className = `layout-block layout-${block.role}`;
    node.dataset.blockId = block.id; node.dataset.layoutStart = Math.max(start, block.start);
    node.dataset.layoutEnd = Math.min(end, block.end);
    if (block.association) {
      node.dataset.speech = block.association; node.setAttribute('role', 'group');
      const speakerBlock = layout.blocks.find(b => b.association === block.association && b.speaker);
      if (speakerBlock) node.setAttribute('aria-label', `Speech by ${speakerBlock.speaker}`);
    }
    node.style.textAlign = block.align;
    node.style.setProperty('--source-indent', `${Math.min(5, block.indent)}em`);
    node.style.setProperty('--first-indent', `${block.continued ? 0 : Math.min(4, block.firstIndent ?? 0)}em`);
    if (decorate && block.role === 'paragraph' && !block.continued && block.start === 0) node.classList.add('drop-cap');
    if (!preserve) node.textContent = layout.projection.text.slice(Math.max(start, block.start), Math.min(end, block.end));
    else for (const [index, line] of block.lines.entries()) {
      if (index) node.append(doc.createTextNode('\n'));
      const span = doc.createElement('span'); span.className = 'layout-line';
      span.dataset.layoutStart = line.fragmentStart; span.dataset.layoutEnd = line.fragmentEnd;
      const region = layout.regions.find(r => r.id === block.regionId);
      span.style.setProperty('--line-indent', `${Math.max(0, Math.min(6, (line.x - (region?.x ?? line.x)) / layout.bodySize))}em`);
      span.textContent = line.text;
      // Labels may share a source TextItem with speech. This is a conservative
      // string subdivision, not a claim of per-glyph source geometry.
      if (block.speaker && !block.continued && index === 0 && line.text.startsWith(block.speaker)) {
        const label = doc.createElement('strong'); label.className = 'layout-speaker'; label.textContent = block.speaker;
        span.replaceChildren(label, doc.createTextNode(line.text.slice(block.speaker.length)));
      }
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
