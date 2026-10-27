import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookPager, fragmentAt, paginateText } from '../src/book-pagination.js';
import { paginateLayout, renderLayout } from '../src/layout-reading.js';

test('pagination preserves every character and prefers whitespace boundaries', () => {
  const text = 'First paragraph.\n\nSecond paragraph, with spaces.  End.';
  const fragments = paginateText(text, slice => slice.length <= 13);
  assert.equal(fragments.map(fragment => fragment.text).join(''), text);
  assert.equal(fragments[0].start, 0);
  assert.ok(fragments.every((fragment, index) => fragment.start === (index ? fragments[index - 1].end : 0)));
  assert.equal(fragments.at(-1).end, text.length);
  assert.ok(fragments.slice(0, -1).every(fragment => /\s$/u.test(fragment.text)));
});

test('an oversized token is split at fitting character boundaries', () => {
  const fragments = paginateText('supercalifragilistic', slice => slice.length <= 5);
  assert.deepEqual(fragments.map(fragment => fragment.text), ['super', 'calif', 'ragil', 'istic']);
});

test('text that fits through its end stays together, including trailing whitespace', () => {
  assert.deepEqual(paginateText('one two', slice => slice.length <= 7), [
    { start: 0, end: 7, text: 'one two' },
  ]);
  assert.deepEqual(paginateText('one two ', slice => slice.length <= 8), [
    { start: 0, end: 8, text: 'one two ' },
  ]);
});

test('the final fitting remainder is not split into a needless last word leaf', () => {
  const fragments = paginateText('one two three four', slice => slice.length <= 11);
  assert.deepEqual(fragments.map(fragment => fragment.text), ['one two ', 'three four']);
});

test('Unicode code points, including surrogate pairs, are never broken', () => {
  const text = 'a😀b 🐈‍⬛ z';
  const fragments = paginateText(text, slice => [...slice].length <= 2);
  assert.equal(fragments.map(fragment => fragment.text).join(''), text);
  for (const fragment of fragments) {
    assert.ok(!/[\uD800-\uDBFF]$/u.test(fragment.text));
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(fragment.text));
  }
});

test('fit measurement can account for a chapter header only on the first fragment', () => {
  const text = 'one two three four five six';
  const fragments = paginateText(text, (slice, { start }) => slice.length + (start === 0 ? 8 : 0) <= 13);
  assert.equal(fragments[0].text, 'one ');
  assert.ok(fragments.slice(1).every(fragment => fragment.text.length <= 13));
  assert.equal(fragments.map(fragment => fragment.text).join(''), text);
});

test('an already aborted signal throws AbortError', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => paginateText('content', () => true, { signal: controller.signal }), { name: 'AbortError' });
});

test('an abort raised by the fit callback stops pagination immediately', () => {
  const controller = new AbortController();
  let calls = 0;
  assert.throws(() => paginateText('several words to paginate', () => {
    calls += 1;
    controller.abort();
    return true;
  }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('empty text has one zero-length fragment and an unfit glyph still progresses', () => {
  assert.deepEqual(paginateText('', () => false), [{ start: 0, end: 0, text: '' }]);
  assert.deepEqual(paginateText('😀', () => false), [{ start: 0, end: 2, text: '😀' }]);
});

test('fragmentAt finds half-open intervals and clamps offsets outside the page', () => {
  const fragments = [{ start: 0, end: 4 }, { start: 4, end: 9 }, { start: 9, end: 12 }];
  assert.equal(fragmentAt(fragments, 3), 0);
  assert.equal(fragmentAt(fragments, 4), 1);
  assert.equal(fragmentAt(fragments, 11), 2);
  assert.equal(fragmentAt(fragments, 12), 2);
  assert.equal(fragmentAt(fragments, 100), 2);
  assert.equal(fragmentAt(fragments, -5), 0);
  assert.equal(fragmentAt([], 0), -1);
});

test('a spread starts within a source page, crosses a page, and preserves fragment metadata', async () => {
  const pages = [
    [{ start: 0, end: 3, text: 'abc', kind: 'text' }, { start: 3, end: 6, text: 'def', kind: 'text' }],
    [{ start: 0, end: 2, text: 'gh', kind: 'scan', marker: 7 }],
  ];
  const pager = createBookPager({ count: 2, loadFragments: async page => pages[page - 1] });
  assert.deepEqual(await pager.spread({ page: 1, offset: 4 }, 2), {
    anchor: { page: 1, offset: 3 },
    leaves: [
      { start: 3, end: 6, text: 'def', kind: 'text', page: 1 },
      { start: 0, end: 2, text: 'gh', kind: 'scan', marker: 7, page: 2 },
    ],
    next: null,
  });
});

test('spreads return the exact next fragment and end cleanly at EOF', async () => {
  const pages = [
    [{ start: 0, end: 2, text: 'aa' }, { start: 2, end: 4, text: 'bb' }],
    [{ start: 0, end: 2, text: 'cc' }],
  ];
  const pager = createBookPager({ count: 2, loadFragments: async page => pages[page - 1] });
  const first = await pager.spread({ page: 1, offset: 0 }, 2);
  assert.deepEqual(first.next, { page: 2, offset: 0 });
  const last = await pager.spread(first.next, 2);
  assert.equal(last.leaves.length, 1);
  assert.equal(last.next, null);
  assert.deepEqual(await pager.spread({ page: 2, offset: 999 }, 2), {
    anchor: { page: 2, offset: 0 },
    leaves: [{ start: 0, end: 2, text: 'cc', page: 2 }],
    next: null,
  });
});

test('previous moves across source-page boundaries and clamps at the first fragment', async () => {
  const pages = [
    [{ start: 0, end: 2, text: 'aa' }, { start: 2, end: 4, text: 'bb' }],
    [{ start: 0, end: 2, text: 'cc' }, { start: 2, end: 4, text: 'dd' }],
  ];
  const pager = createBookPager({ count: 2, loadFragments: async page => pages[page - 1] });
  assert.deepEqual(await pager.previous({ page: 2, offset: 0 }, 1), { page: 1, offset: 2 });
  assert.deepEqual(await pager.previous({ page: 2, offset: 2 }, 2), { page: 1, offset: 2 });
  assert.deepEqual(await pager.previous({ page: 1, offset: 0 }, 9), { page: 1, offset: 0 });
});

test('fitting a long source page never measures an enormous remaining tail', () => {
  const text = 'word '.repeat(20000);
  let calls = 0; let measured = 0; let largest = 0;
  const fragments = paginateText(text, slice => {
    calls++; measured += slice.length; largest = Math.max(largest, slice.length);
    return slice.length <= 500;
  });
  assert.equal(fragments.length, 200);
  assert.equal(fragments.map(f => f.text).join(''), text);
  assert.ok(largest <= 1024, `largest measured slice was ${largest}`);
  assert.ok(measured < text.length * 3, `measured ${measured} characters`);
  assert.ok(calls < 600, `used ${calls} fit calls`);
});

test('capacity hints cannot change breaks when leaf capacity varies or glyphs do not fit', () => {
  const text = 'A\u{1f600} word\tthen\n\nnext \u2003'.repeat(75);
  for (const base of [0, 1, 2, 9, 31, 513, 4000]) {
    const capacity = start => base + start % 13;
    const fragments = paginateText(text, (slice, { start }) => [...slice].length <= capacity(start));
    assert.equal(fragments.map(f => f.text).join(''), text);
    for (const fragment of fragments) {
      assert.ok(!/[\uD800-\uDBFF]$/u.test(fragment.text));
      assert.ok(!/^[\uDC00-\uDFFF]/u.test(fragment.text));
      // Independently enumerate fitting code points and apply the word rule.
      const remaining = [...text.slice(fragment.start)];
      const fitting = remaining.slice(0, capacity(fragment.start)).join('');
      const words = [...fitting.matchAll(/\s/gu)];
      const expected = fitting.length === text.length - fragment.start ? fitting
        : words.length ? fitting.slice(0, words.at(-1).index + 1) : fitting || remaining[0];
      assert.equal(fragment.text, expected);
    }
  }
});

function renderTextLayout(layout, options) {
  const doc = {
    createTextNode: text => ({ textContent: text }),
    createElement: tag => ({ tag, ownerDocument: doc, children: [], dataset: {},
      style: { setProperty() {} }, setAttribute() {},
      append(...nodes) { this.children.push(...nodes); },
      get textContent() { return this.children.map(node => node.textContent).join(''); },
    }),
  };
  const host = doc.createElement('div');
  renderLayout(host, layout, options);
  return host;
}

test('mixed source emphasis survives canonical leaf cuts without changing text', () => {
  const text = 'plain italic bold both end';
  const layout = { projection: { text, emphasis: [
    { start: 6, end: 12, bold: false, italic: true },
    { start: 13, end: 17, bold: true, italic: false },
    { start: 18, end: 22, bold: true, italic: true },
  ] }, regions: [], blocks: [{ id: 'body', role: 'paragraph', start: 0, end: text.length, lines: [] }] };
  const whole = renderTextLayout(layout).children[0];
  assert.equal(whole.textContent, text);
  assert.equal(whole.children.find(node => node.tag === 'em').textContent, 'italic');
  assert.deepEqual(whole.children.filter(node => node.tag === 'strong').map(node => node.textContent), ['bold', 'both']);
  assert.equal(whole.children.find(node => node.textContent === 'both').children[0].tag, 'em');
  const clipped = renderTextLayout(layout, { start: 8, end: 20 }).children[0];
  assert.equal(clipped.textContent, text.slice(8, 20));
  assert.equal(clipped.children[0].tag, 'em');
  assert.equal(clipped.children[0].textContent, 'alic');
  assert.equal(clipped.children.at(-1).children[0].textContent, 'bo');
  const fragments = paginateLayout(layout, (slice, range) => {
    const rendered = renderTextLayout(layout, range);
    assert.equal(rendered.textContent, slice);
    return rendered.textContent.length <= 10;
  });
  assert.equal(fragments.map(fragment => renderTextLayout(layout, fragment).textContent).join(''), text);
  assert.ok(fragments.every(fragment => fragment.kind === 'layout'));
});

test('speaker labels retain nested source emphasis and continuations omit repeated labels', () => {
  const text = 'GUIDE Take care.';
  const layout = { bodySize: 10, regions: [{ id: 'body', x: 0 }],
    projection: { text, emphasis: [{ start: 0, end: 10, bold: false, italic: true }] },
    blocks: [{ id: 'speech', role: 'speech', speaker: 'GUIDE', association: 's1', regionId: 'body',
      start: 0, end: text.length, lines: [{ start: 0, end: text.length, x: 0 }] }] };
  const line = renderTextLayout(layout).children[0].children[0];
  assert.equal(line.textContent, text);
  assert.equal(line.children[0].className, 'layout-speaker');
  assert.equal(line.children[0].children[0].tag, 'em');
  assert.equal(line.children[0].textContent, 'GUIDE');
  assert.equal(line.children[1].tag, 'em');
  assert.equal(line.children[1].textContent, ' Take');
  const continued = renderTextLayout(layout, { start: 7, end: text.length }).children[0].children[0];
  assert.equal(continued.textContent, text.slice(7));
  assert.ok(continued.children.every(node => node.className !== 'layout-speaker'));
  assert.equal(continued.children[0].textContent, 'ake');
  const unstyled = { ...layout, projection: { text } };
  assert.equal(renderTextLayout(unstyled).textContent, text);
});

test('only a confirmed source continuation suppresses the rendered block gap', () => {
  const text = 'first\n\nnext\n\nstanza';
  const layout = { bodySize: 10, regions: [], projection: { text }, blocks: [
    { id: 'first', role: 'line-group', start: 0, end: 5, continuesToNext: true, lines: [{ start: 0, end: 5, x: 0 }] },
    { id: 'next', role: 'line-group', start: 7, end: 11, lines: [{ start: 7, end: 11, x: 0 }] },
    { id: 'stanza', role: 'line-group', start: 13, end: 19, lines: [{ start: 13, end: 19, x: 0 }] },
  ] };
  const whole = renderTextLayout(layout);
  assert.match(whole.children[0].className, /\blayout-continues\b/);
  assert.ok(whole.children.slice(1).every(node => !node.className.includes('layout-continues')));
  const fragment = renderTextLayout(layout, { start: 2, end: 11 });
  assert.match(fragment.children[0].className, /\blayout-continues\b/);
  assert.equal(fragment.textContent, 'rstnext');
});
