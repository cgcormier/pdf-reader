import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPageLayout } from '../src/pdf-layout-adapter.js';
import { interpretPage, conservation, sourceAt, offsetForSource } from '../src/pdf-layout.js';
import { hasSourceChapterTitle, paginateLayout, resolveReadingPosition } from '../src/layout-reading.js';

const item = (str, y, size = 14) => ({ str, width: str.length * size * .45, transform: [size, 0, 0, size, 50, y] });

test('sample opening title after chapter number is detected without changing text or anchors', async () => {
  const task = getDocument({ data: new Uint8Array(await readFile(new URL('../public/sample.pdf', import.meta.url))), verbosity: 0 });
  try {
    const layout = await readPageLayout(await task.promise, 1);
    const before = structuredClone(layout.projection);
    assert.equal(hasSourceChapterTitle(layout, 'The First Light'), true);
    assert.match(layout.projection.text, /^CHAPTER ONE\n\nThe First Light\n\n/);
    assert.deepEqual(layout.projection, before);
    assert.deepEqual(conservation(layout), { valid: true, errors: [] });
    const fragments = paginateLayout(layout, text => text.length < 45);
    assert.equal(fragments.map(fragment => fragment.text).join(''), before.text);
    for (const fragment of fragments) {
      const offset = fragment.start;
      const source = sourceAt(layout.projection, offset);
      const restored = resolveReadingPosition({ layout }, { page: 1, offset, source, layoutVersion: layout.version });
      assert.equal(restored.offset, offsetForSource(layout.projection, source));
    }
  } finally { await task.destroy(); }
});

test('prefatory and chapter lines can precede an imperfect title role', () => {
  const layout = interpretPage({ items: [item('An opening note', 750), item('CHAPTER ONE', 715, 22),
    item('The First Light', 675), item('The body continues without losing a word.', 635)] });
  assert.equal(hasSourceChapterTitle(layout, 'The First Light'), true);
  assert.equal(hasSourceChapterTitle(layout, 'Chapter ONE: The First Light'), true);
  assert.equal(hasSourceChapterTitle(layout, 'Another title'), false);
  assert.deepEqual(conservation(layout), { valid: true, errors: [] });
});

test('a title mentioned after body prose or deep in the page cannot suppress the intro', () => {
  for (const items of [
    [item('Ordinary opening prose ends here.', 730), item('The First Light', 690)],
    [item('An opening note', 730), item('The First Light', 400)],
    [item('The First Light appears within a complete body sentence.', 730)],
  ]) assert.equal(hasSourceChapterTitle(interpretPage({ items }), 'The First Light'), false);
});

test('a confirmed mid-page source heading stays at its source position without an injected copy', () => {
  const layout = interpretPage({ items: [item('Body prose precedes this new section.', 730),
    item('The First Light', 400, 22), item('The next section begins here.', 360)] });
  assert.equal(hasSourceChapterTitle(layout, 'The First Light'), true);
  assert.match(layout.projection.text, /^Body prose/);
  assert.deepEqual(conservation(layout), { valid: true, errors: [] });
});
