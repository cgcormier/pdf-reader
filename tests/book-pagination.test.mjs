import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookPager, fragmentAt, paginateText, paginateTextSteps, runPaginationSteps, FIT_CACHE_LIMIT } from '../src/book-pagination.js';
import { paginateLayout, paginateLayoutSteps, renderLayout } from '../src/layout-reading.js';

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

function paragraphLayout(text) {
  return { projection: { text }, regions: [], blocks: [{ id: 'body', role: 'paragraph', start: 0, end: text.length, lines: [] }] };
}

for (const tail of [48, 65, 74]) test(`a ${tail}-character terminal leaf balances within its source page`, () => {
  const text = 'x '.repeat(500) + 'z'.repeat(tail);
  const fits = slice => slice.length <= 1000;
  assert.equal(paginateText(text, fits).at(-1).text.length, tail);
  const fragments = paginateLayout(paragraphLayout(text), fits);
  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].start, 0);
  assert.equal(fragments[0].end, fragments[1].start);
  assert.equal(fragments[1].end, text.length);
  assert.equal(fragments.map(fragment => fragment.text).join(''), text);
  assert.ok(fragments.every(fragment => fragment.kind === 'layout' && fits(fragment.text)));
  assert.ok(Math.min(...fragments.map(fragment => fragment.text.length)) / text.length > .49);
});

test('tail balancing leaves meaningful heading boundaries and already substantial tails alone', () => {
  const text = 'x '.repeat(500) + '\n\nSCENE\n\nA short ending.';
  const layout = paragraphLayout(text);
  layout.blocks = [{ id: 'body', role: 'paragraph', start: 0, end: 1000, lines: [] },
    { id: 'heading', role: 'heading', start: 1002, end: 1007, lines: [] },
    { id: 'end', role: 'paragraph', start: 1009, end: text.length, lines: [] }];
  const fits = slice => slice.length <= 1000;
  assert.deepEqual(paginateLayout(layout, fits).map(({ start, end, text }) => ({ start, end, text })), paginateText(text, fits));
  const substantial = 'x '.repeat(700);
  assert.deepEqual(paginateLayout(paragraphLayout(substantial), fits).map(({ start, end, text }) => ({ start, end, text })), paginateText(substantial, fits));
});

test('a quarter-length tail stays unchanged and earlier leaves keep their boundaries', () => {
  const text = 'x '.repeat(600);
  const fits = slice => slice.length <= 900;
  assert.deepEqual(paginateLayout(paragraphLayout(text), fits).map(fragment => fragment.text.length), [900, 300]);
  const longer = 'x '.repeat(1000) + 'tail';
  const fragments = paginateLayout(paragraphLayout(longer), slice => slice.length <= 1000);
  assert.deepEqual(fragments.map(fragment => fragment.text.length), [1000, 502, 502]);
  assert.equal(fragments.map(fragment => fragment.text).join(''), longer);
});

test('tail balancing uses source-line boundaries and keeps labels with the following speech', () => {
  const text = 'x '.repeat(525);
  const layout = paragraphLayout(text);
  layout.blocks = [{ id: 'verse', role: 'line-group', start: 0, end: text.length,
    lines: Array.from({ length: 11 }, (_, index) => ({ start: index * 100, end: Math.min(text.length, index * 100 + 99) })) }];
  const balanced = paginateLayout(layout, slice => slice.length <= 1000);
  assert.equal(balanced[0].end, 500);
  const speechText = text.slice(0, 500) + 'VOICE\n\n' + text.slice(507);
  const speech = paragraphLayout(speechText);
  speech.blocks = [{ id: 'opening', role: 'paragraph', start: 0, end: 498, lines: [] },
    { id: 'label', role: 'speech', start: 500, end: 505, speaker: 'VOICE', association: 's1', lines: [{ start: 500, end: 505 }] },
    { id: 'reply', role: 'line-group', start: 507, end: speechText.length, association: 's1',
      lines: [{ start: 507, end: 599 }, { start: 600, end: 799 }, { start: 800, end: 999 }, { start: 1000, end: speechText.length }] }];
  const fragments = paginateLayout(speech, slice => slice.length <= 1000);
  assert.equal(fragments[0].end, 500, 'the closer boundary after VOICE would orphan its label');
  assert.ok(fragments[1].text.startsWith('VOICE\n\n'));
  assert.equal(fragments.map(fragment => fragment.text).join(''), speechText);
});

test('tail balancing keeps the original split when no safe candidate fits both leaves', () => {
  const text = 'x '.repeat(500) + 'z'.repeat(74);
  const fits = (slice, { start }) => slice.length <= (start === 0 ? 1000 : 74);
  assert.deepEqual(paginateLayout(paragraphLayout(text), fits).map(({ start, end, text }) => ({ start, end, text })), paginateText(text, fits));
  const word = 'x'.repeat(1050);
  assert.deepEqual(paginateLayout(paragraphLayout(word), slice => slice.length <= 1000).map(fragment => fragment.text.length), [1000, 50]);
});

test('balanced fragments retain clipped emphasis and pager forward/backward symmetry', async () => {
  const text = 'x '.repeat(525);
  const layout = paragraphLayout(text);
  layout.projection.emphasis = [{ start: 400, end: 800, bold: true, italic: true }];
  const fragments = paginateLayout(layout, slice => slice.length <= 1000);
  assert.ok(fragments[0].end > 500 && fragments[0].end < 550);
  assert.equal(fragments.map(fragment => renderTextLayout(layout, fragment).textContent).join(''), text);
  const styledText = fragments.flatMap(fragment => renderTextLayout(layout, fragment).children[0].children)
    .filter(node => node.tag === 'strong').map(node => node.textContent).join('');
  assert.equal(styledText, text.slice(400, 800));
  const pager = createBookPager({ count: 2, loadFragments: async page => page === 1 ? fragments : [{ start: 0, end: 0, text: '', kind: 'scan' }] });
  const first = await pager.spread({ page: 1, offset: 600 }, 1);
  assert.equal(first.anchor.offset, fragments[1].start);
  const previous = await pager.previous(first.anchor);
  assert.deepEqual(previous, { page: 1, offset: 0 });
  assert.deepEqual((await pager.spread(previous, 1)).next, first.anchor);
  const scan = await pager.spread(first.next, 1);
  assert.equal(scan.leaves[0].kind, 'scan');
  assert.deepEqual(await pager.previous(scan.anchor), first.anchor);
});

test('tail balancing preserves empty and oversized leaves and aborts extra fit probes', () => {
  assert.deepEqual(paginateLayout(paragraphLayout(''), () => true).map(fragment => fragment.text), ['']);
  assert.equal(paginateLayout(paragraphLayout('\u{1f600}'), () => false)[0].kind, 'overflow');
  const text = 'x '.repeat(525);
  let greedyCalls = 0;
  paginateText(text, slice => { greedyCalls++; return slice.length <= 1000; });
  const controller = new AbortController(); let calls = 0;
  assert.throws(() => paginateLayout(paragraphLayout(text), slice => {
    if (++calls > greedyCalls) controller.abort();
    return slice.length <= 1000;
  }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, greedyCalls + 1);
});

test('step and synchronous pagination preserve identical absolute UTF-16 fragments', () => {
  const text = 'A\u{1f600} word\n\nthen another measured source word. '.repeat(30);
  const layout = paragraphLayout(text);
  const fits = (slice, { start }) => slice.length <= (start === 0 ? 87 : 103);
  for (const [steps, expected] of [
    [paginateTextSteps(text), paginateText(text, fits)],
    [paginateLayoutSteps(layout), paginateLayout(layout, fits)],
  ]) {
    const actual = runPaginationSteps(steps, (slice, range) => {
      assert.equal(slice, text.slice(range.start, range.end));
      return fits(slice, range);
    });
    assert.deepEqual(actual, expected);
    assert.equal(actual.map(fragment => fragment.text).join(''), text);
  }
});

test('exact range measurements are reused through balancing and final classification', () => {
  const text = 'x '.repeat(500) + 'z'.repeat(74);
  const measured = new Set();
  const fragments = paginateLayout(paragraphLayout(text), (slice, { start, end }) => {
    const key = `${start}:${end}`;
    assert.ok(!measured.has(key), `repeated exact probe ${key}`); measured.add(key);
    return slice.length <= 1000;
  });
  assert.ok(fragments.every(fragment => measured.has(`${fragment.start}:${fragment.end}`)));
  assert.ok(fragments.every(fragment => fragment.kind === 'layout'));
  let overflowProbes = 0;
  assert.equal(paginateLayout(paragraphLayout('\u{1f600}'), () => { overflowProbes++; return false; })[0].kind, 'overflow');
  assert.equal(overflowProbes, 1, 'oversized glyph still receives one exact measurement');
});

test('speaker suffix refits yield absolute ranges and preserve contiguous source text', () => {
  const text = 'x '.repeat(47) + ' GUIDE\n\n' + 'reply '.repeat(40);
  const layout = paragraphLayout(text);
  layout.blocks = [
    { id: 'opening', role: 'paragraph', start: 0, end: 94, lines: [] },
    { id: 'speaker', role: 'speech', speaker: 'GUIDE', start: 95, end: 100, lines: [{ start: 95, end: 100 }] },
    { id: 'reply', role: 'line-group', start: 102, end: text.length, lines: [{ start: 102, end: text.length }] },
  ];
  let repairedProbe = false;
  const fragments = runPaginationSteps(paginateLayoutSteps(layout), (slice, { start, end }) => {
    assert.equal(slice, text.slice(start, end));
    if (start === 95) repairedProbe = true;
    return slice.length <= 101;
  });
  assert.equal(repairedProbe, true);
  assert.equal(fragments[0].end, 95);
  assert.equal(fragments[1].start, 95);
  assert.equal(fragments.map(fragment => fragment.text).join(''), text);
  assert.ok(fragments.every((fragment, index) => fragment.start === (index ? fragments[index - 1].end : 0)));
});

test('range memo is invocation-local and evicts old probes at its fixed bound', () => {
  function* steps() {
    for (let start = 0; start <= FIT_CACHE_LIMIT; start++) yield { text: 'x', start, end: start + 1 };
    yield { text: 'x', start: FIT_CACHE_LIMIT, end: FIT_CACHE_LIMIT + 1 };
    yield { text: 'x', start: 0, end: 1 };
  }
  for (let invocation = 0; invocation < 2; invocation++) {
    let probes = 0;
    runPaginationSteps(steps(), () => { probes++; return true; });
    assert.equal(probes, FIT_CACHE_LIMIT + 2, 'recent probe reused; oldest evicted; new invocation measures again');
  }
});

test('a suspended fitting generator observes cancellation before another probe', async () => {
  const controller = new AbortController();
  const steps = paginateLayoutSteps(paragraphLayout('source words '.repeat(300)), { signal: controller.signal });
  const first = steps.next(); assert.equal(first.done, false);
  const result = first.value.text.length <= 100;
  await new Promise(resolve => setTimeout(() => { controller.abort(); resolve(); }, 0));
  assert.throws(() => steps.next(result), { name: 'AbortError' });
});

test('cancellation is checked for cached requests as well as new DOM probes', () => {
  const controller = new AbortController(); let probes = 0;
  function* steps() {
    yield { text: 'x', start: 0, end: 1 };
    controller.abort();
    yield { text: 'x', start: 0, end: 1 };
  }
  assert.throws(() => runPaginationSteps(steps(), () => { probes++; return true; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(probes, 1);
});

test('failed final-pair candidates do not infer fitting bounds from nearby suffixes', () => {
  const text = 'x '.repeat(500) + 'z'.repeat(74);
  const fragments = paginateLayout(paragraphLayout(text), (slice, { start }) =>
    start === 0 ? slice.length <= 1000 : start === 550 || start >= 1000 && slice.length <= 74);
  assert.deepEqual(fragments.map(({ start, end }) => ({ start, end })), [{ start: 0, end: 550 }, { start: 550, end: 1074 }]);
  assert.equal(fragments.map(fragment => fragment.text).join(''), text);
  assert.ok(fragments.every(fragment => fragment.kind === 'layout'));
});
