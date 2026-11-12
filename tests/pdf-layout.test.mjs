import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretPage, conservation, structureLines, inversePoint, sourceAt, offsetForSource, layoutSlice } from '../src/pdf-layout.js';
import { resolveReadingPosition, paginateLayout } from '../src/layout-reading.js';
import { extractPage } from '../src/pdf-engine.js';
import { readPageLayout, clearPageLayouts } from '../src/pdf-layout-adapter.js';
import { analyzeDocumentStructure } from '../src/document-structure.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeLayoutPdf, layoutPages, modestHeadingPages, runningHeaderPages } from './pdf-layout-fixture.mjs';

const item = (str, x, y, size = 10, width = str.length * size * .45, extra = {}) => ({ str, width, transform: [size, 0, 0, size, x, y], ...extra });
const layout = items => interpretPage({ items });
const text = l => l.projection.text;
const valid = l => assert.deepEqual(conservation(l), { valid: true, errors: [] });

test('emphasis preserves canonical UTF-16 text, source mapping and clipped slices', () => {
  const items = [item('Plain ', 40, 700, 10, 30, { fontName: 'plain' }),
    item('bold', 70, 700, 10, 20, { fontName: 'bold' }),
    item(' italic\t😀 ', 90, 700, 10, 45, { fontName: 'italic' }),
    item('both', 135, 700, 10, 20, { fontName: 'both' })];
  const plain = interpretPage({ items });
  const result = interpretPage({ items, styles: { bold: { bold: true }, italic: { italic: true }, both: { bold: true, italic: true } } });
  assert.equal(text(result), text(plain));
  assert.deepEqual(result.projection.segments, plain.projection.segments);
  assert.deepEqual(result.projection.omitted, plain.projection.omitted);
  assert.deepEqual(result.projection.emphasis.map(range => ({ ...range, text: text(result).slice(range.start, range.end) })), [
    { start: 6, end: 10, bold: true, italic: false, text: 'bold' },
    { start: 11, end: 20, bold: false, italic: true, text: 'italic 😀' },
    { start: 21, end: 25, bold: true, italic: true, text: 'both' },
  ]);
  const slices = paginateLayout(result, slice => slice.length <= 14);
  assert.equal(slices.map(slice => slice.text).join(''), text(plain));
  for (const offset of [6, 9, 11, 18, 19, 21, 24]) {
    const source = sourceAt(result.projection, offset);
    assert.equal(offsetForSource(result.projection, source), offset);
    const position = { page: 1, offset, source, layoutVersion: result.version };
    assert.deepEqual(resolveReadingPosition({ layout: result }, position), resolveReadingPosition({ layout: plain }, position));
  }
  valid(result);
});

test('emphasis uses explicit metadata and source face suffixes without interpreting font IDs', () => {
  const styles = {
    a: { sourceFontName: 'ABCDEF+TimesNewRomanPS-BoldItalicMT' },
    b: { sourceFontName: 'ArialBoldMT' },
    c: { fontWeight: '700', fontStyle: 'oblique 12deg' },
    d: { sourceFontName: 'Bolden' }, e: { sourceFontName: 'Italicus' }, f: { sourceFontName: 'Blackburn' },
    g_d0_BoldItalic: { fontFamily: 'serif' },
    normal: { sourceFontName: 'Helvetica-BoldOblique', bold: false, italic: false },
  };
  const result = interpretPage({ items: Object.keys(styles).map((fontName, index) => item('word', 40, 700 - index * 20, 10, 20, { fontName })), styles });
  assert.deepEqual(result.runs.map(run => [run.style.bold, run.style.italic]), [
    [true, true], [true, false], [true, true], [false, false], [false, false], [false, false], [false, false], [false, false],
  ]);
  assert.equal(layout([item('Missing metadata.', 40, 700)]).projection.emphasis, undefined);
  valid(result);
});

test('PDF.js adapter loads actual font metadata and tolerates unavailable font records', async () => {
  let operators = 0;
  const pdf = { numPages: 1, getPage: async () => ({ view: [0, 0, 600, 800],
    getTextContent: async () => ({ items: [item('Styled', 40, 700, 10, 30, { fontName: 'g_d0_f1' }), item(' missing', 70, 700, 10, 40, { fontName: 'g_d0_f2' })],
      styles: { g_d0_f1: { fontFamily: 'serif' }, g_d0_f2: { fontFamily: 'serif' } } }),
    getOperatorList: async () => { operators++; },
    commonObjs: { get: id => { if (id === 'g_d0_f2') throw new Error('unavailable'); return { name: 'ABCDEF+TimesNewRomanPS-ItalicMT' }; } },
  }) };
  const result = await readPageLayout(pdf, 1);
  assert.equal(operators, 1);
  assert.deepEqual(result.projection.emphasis, [{ start: 0, end: 6, bold: false, italic: true }]);
  assert.equal(text(result), 'Styled missing'); valid(result);
  clearPageLayouts(pdf);
  const failure = { numPages: 1, getPage: async () => ({ view: [0, 0, 600, 800],
    getTextContent: async () => ({ items: [item('Still readable.', 40, 700)] }),
    getOperatorList: async () => { throw new Error('unsupported'); }, commonObjs: { get: () => null },
  }) };
  assert.equal(text(await readPageLayout(failure, 1)), 'Still readable.');
});

test('installed PDF.js resolves emphasis when public text styles contain only a generic family', async () => {
  const task = getDocument({ data: makeLayoutPdf([{ items: [
    { text: 'Ordinary', x: 40, y: 700 }, { text: 'italic words', x: 90, y: 700, italic: true },
  ] }]), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const publicContent = await page.getTextContent({ includeMarkedContent: true });
    assert.ok(Object.values(publicContent.styles).every(style => style.italic === undefined && style.fontStyle === undefined));
    const plain = interpretPage(publicContent);
    const result = await readPageLayout(pdf, 1);
    assert.equal(text(result), text(plain));
    assert.deepEqual(result.projection.segments, plain.projection.segments);
    assert.deepEqual(result.projection.emphasis.map(range => ({ ...range, text: text(result).slice(range.start, range.end) })), [
      { start: 9, end: 21, bold: false, italic: true, text: 'italic words' },
    ]);
    valid(result);
  } finally { await task.destroy(); }
});

test('italic multiline stage text preserves existing canonical separators and source anchors', () => {
  const items = [item('ACT I', 250, 740, 18), item('GUIDE', 40, 700), item('We await the company.', 60, 680),
    item('SCOUT', 40, 660), item('They approach.', 60, 640), item('GUIDE', 40, 620),
    item('Enter the travellers carrying their lanterns,', 40, 600, 10, 240, { fontName: 'face' }),
    item('with the players and all their attendants', 40, 586, 10, 240, { fontName: 'face' }),
    item('GUIDE Our company is here.', 40, 560)];
  const plain = interpretPage({ items });
  const styled = interpretPage({ items, styles: { face: { italic: true } } });
  assert.equal(text(styled), text(plain));
  assert.deepEqual(styled.projection.segments, plain.projection.segments);
  assert.deepEqual(styled.blocks.map(block => [block.role, block.start, block.end]), plain.blocks.map(block => [block.role, block.start, block.end]));
  assert.ok(styled.projection.emphasis.length); valid(styled);
});

test('indexed layout slices retain exact boundaries and source lines across a large page', () => {
  const blocks = Array.from({ length: 200 }, (_, index) => ({ id: `b${index}`, start: index * 10, end: index * 10 + 8,
    lines: [{ start: index * 10, end: index * 10 + 3 }, { start: index * 10 + 4, end: index * 10 + 8 }] }));
  const page = { blocks, projection: { text: '0123456789'.repeat(200) } };
  for (const [start, end] of [[0, 3], [3, 4], [8, 10], [12, 35], [1900, 1998], [1998, 2000], [50, 50]]) {
    const reference = blocks.filter(b => b.end > start && b.start < end).map(b => ({ ...b, continued: start > b.start,
      lines: b.lines.filter(l => l.end > start && l.start < end).map(l => ({ ...l,
        text: page.projection.text.slice(Math.max(start, l.start), Math.min(end, l.end)),
        fragmentStart: Math.max(start, l.start), fragmentEnd: Math.min(end, l.end) })) }));
    assert.deepEqual(layoutSlice(page, start, end), reference);
  }
});
function lowered({ size = 30, y = 660, quote = false } = {}) {
  return [item('M', 40, y, size, 25), ...(quote ? [item('“', 33, 674, 10, 5)] : []),
    item('y goal in writing this book has been to create a very inexpensive', 66, 674, 10, 350),
    item('high-quality textbook.', 66, 660, 10, 120), item('The third original line continues.', 66, 646, 10, 180)];
}

for (const options of [{}, { size: 40, y: 646 }, { quote: true }, { size: 25, y: 674 }]) {
  test(`decorative initial ordering and coverage ${JSON.stringify(options)}`, () => {
    const result = layout(lowered(options));
    assert.match(text(result), options.quote ? /^“My goal/u : /^My goal/u);
    assert.equal(result.decorativeInitials.length, 1);
    assert.equal(text(result).match(/M/g).length, 1);
    assert.ok(structureLines(result).every(l => l.size === 10));
    valid(result);
  });
}

test('split opening runs join without losing punctuation, ligatures or hyphens', () => {
  const result = layout([item('M', 40, 660, 30, 25), item('y', 66, 674, 10, 5), item(' goal: ﬁne soft\u00adhyphen-', 72, 674, 10, 125), item('ation.', 66, 660)]);
  assert.match(text(result), /^My goal: ﬁne soft\u00adhyphen-/u); valid(result);
});

for (const [name, extra] of [
  ['variable', [item('X', 40, 674, 30, 20), item('is a mathematical variable.', 75, 674)]],
  ['equation', [item('X', 40, 660, 30, 20), item('= y + 2', 62, 674), item('= z', 62, 660)]],
  ['heading', [item('A', 40, 730, 30), item('The next paragraph starts here.', 40, 670)]],
  ['first word', [item('My', 40, 660, 30, 25), item('goal remains', 66, 674), item('original.', 66, 660)]],
  ['neighboring column', [item('M', 40, 660, 30, 20), item('y goal is over here.', 330, 674), item('more text.', 330, 660)]],
  ['ambiguous targets', [item('M', 40, 660, 30, 20), item('y goal', 61, 674), item('aybe', 65, 674), item('more text.', 61, 660)]],
]) test(`negative initial: ${name}`, () => {
  const result = layout([...extra, item('Normal body text sets the measure.', 40, 600)]);
  assert.equal(result.decorativeInitials.length, 0); valid(result);
});

for (const columns of [1, 2, 3]) test(`${columns} columns have exact regional reading order`, () => {
  const items = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < columns; col++) items.push(item(`Column ${col} row ${row} prose.`, 30 + col * 185, 700 - row * 15, 10, 135));
  const result = layout(items);
  assert.deepEqual(result.lines.map(l => l.text), Array.from({ length: columns }, (_, col) => Array.from({ length: 4 }, (_, row) => `Column ${col} row ${row} prose.`)).flat()); valid(result);
});

test('mid-page spanning line separates column bands and changing column counts', () => {
  const items = [];
  for (const y of [700, 680, 600, 580]) for (const x of [30, 330]) items.push(item(`${x === 30 ? 'Left' : 'Right'} ${y} original prose.`, x, y, 10, 180));
  items.push(item('A spanning middle heading', 160, 640, 20, 280), item('Full width closing text.', 30, 520, 10, 500));
  const result = layout(items);
  assert.deepEqual(result.lines.map(l => l.text), ['Left 700 original prose.', 'Left 680 original prose.', 'Right 700 original prose.', 'Right 680 original prose.', 'A spanning middle heading', 'Left 600 original prose.', 'Left 580 original prose.', 'Right 600 original prose.', 'Right 580 original prose.', 'Full width closing text.']); valid(result);
  // A simpler whole-page gutter cut puts the lower-left band before the
  // upper-right band. The constrained band cut is justified by this fixture.
  const globalCut = [...items.filter(i => i.transform[4] < 300).sort((a, b) => b.transform[5] - a.transform[5]),
    ...items.filter(i => i.transform[4] >= 300).sort((a, b) => b.transform[5] - a.transform[5])].map(i => i.str);
  assert.notDeepEqual(globalCut, result.lines.map(l => l.text));
});

test('numeric tables and sidebars remain accounted for without invented text columns', () => {
  const result = layout([item('Name', 40, 700), item('25', 180, 700), item('50', 230, 700), item('75', 280, 700), item('Totals', 40, 680), item('30', 180, 680), item('40', 230, 680), item('90', 280, 680)]);
  assert.equal(result.regions.length, 1); valid(result);
});

test('aligned label and numeric cells retain separate rows and source mappings', () => {
  const items = ['Apples', 'Pears', 'Plums', 'Peaches'].flatMap((label, index) => [
    item(label, 60, 700 - index * 25), item(String(index + 12), 250, 700 - index * 25),
  ]);
  const result = layout(items);
  assert.deepEqual(result.blocks.map(block => [block.role, text(result).slice(block.start, block.end)]), [
    ['unknown', 'Apples 12'], ['unknown', 'Pears 13'], ['unknown', 'Plums 14'], ['unknown', 'Peaches 15'],
  ]);
  for (let index = 0; index < items.length; index++) {
    const source = { item: index, offset: 0 };
    assert.deepEqual(sourceAt(result.projection, offsetForSource(result.projection, source)), source);
  }
  valid(result);
});

test('isolated numbered prose and text columns are not combined into table rows', () => {
  const numbered = layout(Array.from({ length: 3 }, (_, i) => [item('A lengthy sentence continues across this printed line.', 40, 700 - i * 15, 10, 220), item(String(i + 1), 550, 700 - i * 15)]).flat());
  assert.ok(numbered.lines.every(line => !line.tableLike));
  const isolated = layout([item('Apples', 60, 700), item('12', 250, 700), item('A paragraph follows.', 60, 650)]);
  assert.ok(isolated.lines.every(line => !line.tableLike));
  valid(numbered); valid(isolated);
});

test('indent changes, paragraph gaps and centered headings remain explicit', () => {
  const result = layout([item('Opening prose is reflowable.', 40, 700, 10, 440), item('Continuation also reflows.', 40, 686, 10, 430),
    item('An indented new paragraph.', 60, 660, 10, 400), item('Continuation at body margin.', 40, 646, 10, 440), item('Chapter 2', 230, 600, 18, 140)]);
  assert.ok(result.blocks.length >= 3); assert.ok(result.blocks.some(b => b.indent > 0)); valid(result);
});

test('structural words in wrapped prose do not invent headings or break paragraph flow', () => {
  const source = ['The preceding body line continues into this', 'part of their load and help them to bear it-that will',
    'book of stories and ordinary examples remains body text.', 'section of the narrative continues at the same measure.',
    'section a reader remembers is still ordinary prose.',
    'chapter about an ordinary afternoon continues here.', 'appendix of supporting material is mentioned in prose.',
    'book I read yesterday', 'part one of their load',
    'book civil life describes is still an ordinary sentence.'];
  const result = layout(source.map((str, index) => item(str, 40, 700 - index * 14, 10, 440)));
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].role, 'paragraph');
  assert.equal(text(result), source.join(' '));
  for (const [index, str] of source.entries()) {
    const offset = text(result).indexOf(str);
    assert.deepEqual(sourceAt(result.projection, offset), { item: index, offset: 0 });
    assert.equal(offsetForSource(result.projection, { item: index, offset: str.length - 1 }), offset + str.length - 1);
  }
  valid(result);
});

for (const title of ['Book I', 'Chapter One', 'Chapter One: The Beginning', 'PART TWENTY-ONE', 'Book 2: An Opening', 'Section 2.3 A New Topic',
  'Chapter IV', 'Part xii', 'Section A', 'Section B: Scope', 'Appendix A', 'Appendix III']) test(`numbered heading retains its role: ${title}`, () => {
  const result = layout([item(title, 40, 730), item('Ordinary body prose establishes the page measure.', 40, 690, 10, 440)]);
  assert.equal(result.blocks[0].role, 'heading');
  assert.equal(result.lines[0].text, title);
  assert.deepEqual(sourceAt(result.projection, 0), { item: 0, offset: 0 });
  valid(result);
});

test('unnumbered structural titles can still use validated tags or prominent typography', () => {
  const prominent = layout([item('Book of Stories', 40, 730, 18), item('Ordinary body prose establishes the page measure.', 40, 690, 10, 440)]);
  assert.equal(prominent.blocks[0].role, 'heading'); valid(prominent);
  const tagged = interpretPage({ items: [{ type: 'beginMarkedContentProps', id: 'title' }, item('Book of Stories', 40, 730),
    { type: 'endMarkedContent' }] }, { structTree: { role: 'H1', children: [{ type: 'content', id: 'title' }] } });
  assert.equal(tagged.tags.status, 'validated'); assert.equal(tagged.blocks[0].role, 'heading'); valid(tagged);
});

const modestLayout = page => interpretPage({ items: page.items.map(run => item(run.text, run.x, run.y, run.size, run.width)) }, { view: page.view });
for (const [index, page] of modestHeadingPages.entries()) test(`modest-size titles use placement, casing, spacing and title sequence (${index})`, () => {
  const result = modestLayout(page);
  assert.equal(result.bodySize, index ? 9.8 : 8.85);
  const expected = page.items.slice(10, index ? 12 : 11).map(run => run.text);
  assert.deepEqual(result.blocks.filter(block => block.role === 'heading').map(block => block.lines[0].text), expected);
  for (const heading of structureLines(result).filter(line => line.role === 'heading')) {
    const sourceLine = result.lines.find(line => line.id === heading.sourceLineId);
    assert.equal(heading.regionId, sourceLine.regionId);
    assert.equal(heading.text, sourceLine.text);
    assert.ok(heading.headingReasons.some(reason => /Centered/.test(reason)));
    assert.deepEqual(sourceAt(result.projection, sourceLine.start), { item: sourceLine.runs[0].index, offset: 0 });
  }
  assert.deepEqual(result.runs.map(run => run.text), page.items.map(run => run.text));
  valid(result);
});

test('installed PDF.js retains modest headings at the audited page size and baselines', async () => {
  const task = getDocument({ data: makeLayoutPdf(modestHeadingPages), verbosity: 0 });
  try {
    const pdf = await task.promise;
    for (const [index, page] of modestHeadingPages.entries()) {
      const result = await readPageLayout(pdf, index + 1);
      const headings = result.blocks.filter(block => block.role === 'heading');
      const titles = page.items.slice(10, index ? 12 : 11);
      assert.deepEqual(headings.map(block => block.lines[0].text), titles.map(run => run.text.replace(/'/g, '’')));
      assert.equal(result.width, 248.4); assert.equal(result.height, 425.52);
      assert.ok(result.lines.every(line => line.x >= 0 && line.right <= result.width), 'fixture text must fit the actual PDF page');
      for (const [titleIndex, block] of headings.entries()) {
        const line = block.lines[0]; const original = titles[titleIndex];
        assert.ok(Math.abs(line.x - original.x) < .001);
        assert.ok(Math.abs(line.baseline - (425.52 - original.y)) < .001);
        assert.equal(line.size, original.size);
        assert.deepEqual(sourceAt(result.projection, line.start), { item: line.runs[0].index, offset: 0 });
      }
      valid(result);
    }
  } finally { await task.destroy(); }
});

for (const [name, change] of [
  ['body margin', page => { page.items[10].x = 9; }],
  ['ordinary spacing above', page => { page.items[9].y = page.items[10].y + 11.2; }],
  ['ordinary spacing below', page => { page.items[11].y = page.items[10].y - 11.2; }],
  ['sentence casing', page => { page.items[10].text = "Zarathustra's speeches continue"; }],
  ['body size', page => { page.items[10].size = 9.8; }],
]) test(`near-identical prose lacks title evidence: ${name}`, () => {
  const page = structuredClone(modestHeadingPages[1]); change(page);
  const result = modestLayout(page);
  assert.ok(result.blocks.every(block => block.role !== 'heading'));
  assert.ok(text(result).includes(page.items[10].text)); valid(result);
});

test('neutral verse keeps source lines and stanza gaps without freezing prose', () => {
  const result = layout([item('Across the quiet road', 40, 700), item('We carry borrowed light', 60, 685), item('And wait beside the gate', 40, 670),
    item('Another stanza begins', 40, 630), item('A second line returns', 60, 615), item('The final line remains', 40, 600)].map(run => ({ ...run, hasEOL: true })));
  assert.ok(result.blocks.every(b => b.role === 'line-group'));
  assert.match(text(result), /Across the quiet road\n\nWe carry borrowed light/);
  assert.deepEqual(result.blocks.map(block => !!block.continuesToNext), [true, true, false, true, true, false]);
  assert.ok(result.blocks.some(b => b.indent > 0)); valid(result);
});

test('preserved dramatic lines keep ordinary spacing across punctuation and indents', () => {
  const result = layout([item('ACT I', 100, 740, 18), item('GUIDE', 40, 700),
    item('We wait beside the gate.', 60, 680), item('And watch.', 75, 660),
    item('A separate stanza begins.', 60, 620), item('SCOUT', 40, 580),
    item('We hear you.', 160, 580), item('And answer.', 60, 560), item('GUIDE', 40, 520)]);
  const blockFor = value => result.blocks.find(block => block.lines.some(line => line.text === value));
  assert.equal(blockFor('GUIDE').continuesToNext, true);
  assert.equal(blockFor('We wait beside the gate.').continuesToNext, true);
  assert.equal(blockFor('And watch.').continuesToNext, undefined);
  assert.equal(blockFor('A separate stanza begins.').continuesToNext, undefined);
  assert.equal(blockFor('SCOUT').continuesToNext, true);
  assert.equal(blockFor('We hear you.').continuesToNext, true);
  assert.equal(blockFor('And answer.').continuesToNext, undefined);
  assert.equal(text(result), 'ACT I\n\nGUIDE\n\nWe wait beside the gate.\n\nAnd watch.\n\nA separate stanza begins.\n\nSCOUT\n\nWe hear you.\n\nAnd answer.\n\nGUIDE');
  valid(result);
});

test('stage cues, marginal numbers and prose retain their existing block spacing', () => {
  const items = [item('ACT I', 250, 740, 18), item('GUIDE', 40, 700), item('We wait.', 60, 680),
    item('Enter a messenger.', 205, 660, 10, 120, { fontName: 'italic' }),
    item('The messenger pauses.', 60, 640), item('Ghost exits.', 180, 620, 10, 100, { fontName: 'italic' }),
    item('We hear a sound.', 60, 600), item('25', 400, 580), item('And wait again.', 60, 560), item('SCOUT', 40, 540), item('GUIDE', 40, 520)];
  const result = interpretPage({ items, styles: { italic: { italic: true } } });
  const blockFor = value => result.blocks.find(block => block.lines.some(line => line.text === value));
  for (const value of ['We wait.', 'Enter a messenger.', 'The messenger pauses.', 'Ghost exits.', 'We hear a sound.', '25', 'And wait again.']) {
    assert.equal(blockFor(value).continuesToNext, undefined, value);
  }
  const prose = layout([item('Ordinary prose starts here and continues over the source measure.', 40, 700, 10, 500),
    item('The next paragraph remains prose.', 40, 660, 10, 400)]);
  assert.ok(prose.blocks.every(block => block.role === 'paragraph' && block.continuesToNext === undefined));
  valid(result); valid(prose);
});

test('a first-line prose indent returns to the region body margin', () => {
  const result = layout([item('This first line is indented and continues', 60, 700, 10, 410), item('at the normal body margin without a new paragraph.', 40, 686, 10, 440), item('The prose remains reflowable.', 40, 672, 10, 440)]);
  assert.equal(result.blocks.length, 1); assert.equal(result.blocks[0].firstIndent, 2);
  assert.equal(result.blocks[0].indent, 0); valid(result);
});

test('hanging list continuations keep their association and indentation', () => {
  const result = layout([item('1. An original list item begins here', 40, 700, 10, 400), item('and continues at its hanging indent.', 60, 686, 10, 380), item('2. Another complete item.', 40, 660, 10, 400)]);
  assert.equal(result.blocks[0].role, 'list'); assert.equal(result.blocks[0].lines.length, 2);
  assert.equal(result.blocks[0].firstIndent, -2); assert.equal(result.blocks[0].indent, 2); valid(result);
  assert.ok(structureLines(result).every(line => !line.contentsEligible));
});

test('superscripts do not create headings and furniture does not consume top-edge Acts', () => {
  const result = layout([item('A Book', 450, 770, 10), item('12', 40, 770, 10), item('ACT I', 260, 780, 18),
    item('The body includes x', 40, 700), item('2', 124, 702, 6), item(' and continues.', 130, 700), item('Another ordinary body line.', 40, 685)]);
  assert.ok(result.annotations.some(a => a.projection.text === 'A Book'));
  assert.ok(result.lines.some(l => l.text === 'ACT I'));
  assert.ok(structureLines(result).filter(l => l.y < 750).every(l => l.size === 10)); valid(result);
});

for (const [index, page] of runningHeaderPages.entries()) test(`combined, split and OCR-shaped running headers retain annotation provenance (${index})`, () => {
  const result = modestLayout(page);
  const headerItems = page.items.length - 6;
  assert.ok(result.annotations.length > 0);
  assert.ok(result.annotations.every(annotation => annotation.role === 'running-header'));
  assert.equal(text(result), page.items.slice(headerItems).map(run => run.text).join(' '));
  for (const [itemIndex, original] of page.items.slice(0, headerItems).entries()) {
    const annotation = result.annotations.find(annotation => annotation.lines.some(line => line.runs.some(run => run.index === itemIndex)));
    assert.ok(annotation, original.text);
    for (let offset = 0; offset < original.text.length; offset++) {
      const projected = offsetForSource(annotation.projection, { item: itemIndex, offset });
      assert.deepEqual(sourceAt(annotation.projection, projected), { item: itemIndex, offset });
      assert.equal(annotation.projection.text[projected], original.text[offset]);
    }
  }
  valid(result);
});

test('installed PDF.js isolates offset and OCR-shaped source headers without losing body text', async () => {
  const task = getDocument({ data: makeLayoutPdf(runningHeaderPages), verbosity: 0 });
  try {
    const pdf = await task.promise;
    for (const [index, page] of runningHeaderPages.entries()) {
      const result = await readPageLayout(pdf, index + 1);
      assert.ok(result.annotations.some(annotation => annotation.role === 'running-header'));
      assert.equal(text(result), page.items.slice(-6).map(run => run.text).join(' '));
      assert.ok(result.lines.every(line => line.right <= result.width));
      for (const annotation of result.annotations) for (const line of annotation.lines) {
        for (const run of line.runs) if (run.text.trim()) {
          const projected = offsetForSource(annotation.projection, { item: run.index, offset: 0 });
          assert.deepEqual(sourceAt(annotation.projection, projected), { item: run.index, offset: 0 });
        }
      }
      valid(result);
    }
  } finally { await task.destroy(); }
});

for (const [name, top] of [
  ['sentence ending with a number', [item('The ordinary count increased to 123', 9, 413.52, 8.35, 231)]],
  ['body-size capitalized text', [item('THUS SPOKE AN ORDINARY BODY LINE 123', 9, 413.52, 9.8, 231)]],
  ['small title without folio', [item('THE ?ORTABLE NARRATIVE', 62, 413.52, 8.35, 122)]],
  ['body prose beside a number', [item('The ordinary narrative continues', 62, 413.52, 8.35, 175), item('123', 9, 413.52, 8.35, 14)]],
  ['top-edge numbered chapter', [item('Chapter I', 62, 413.52, 8.35, 100), item('123', 9, 413.52, 8.35, 14)]],
]) test(`near-top body or structural text is retained: ${name}`, () => {
  const page = runningHeaderPages[0];
  const body = page.items.slice(-6).map(run => item(run.text, run.x, run.y, run.size, run.width));
  const result = interpretPage({ items: [...top, ...body] }, { view: page.view });
  assert.equal(result.annotations.length, 0);
  for (const source of top) assert.ok(text(result).includes(source.str));
  valid(result);
});

test('shared verse and stage cues retain their source sequence, including spoken numbers', () => {
  const result = layout([item('ACT I', 250, 740, 18), item('GUIDE We leave at 25. SCOUT Then follow.', 40, 700),
    item('SCOUT', 40, 680), item('[A bell rings.]', 140, 660), item('GUIDE I hear it.', 40, 640)]);
  assert.ok(result.blocks.some(b => b.role === 'speech'));
  assert.match(text(result), /GUIDE We leave at 25\. SCOUT Then follow\./);
  assert.ok(text(result).indexOf('SCOUT\n') < text(result).indexOf('[A bell rings.]')); valid(result);
});

test('prominent speakers and their dialogue cannot supply Contents typography evidence', () => {
  const result = layout([item('ACT I', 250, 740, 18), item('GUIDE', 40, 700, 22), item('A long ordinary speech sets the normal body type measure for this page.', 40, 680),
    item('SCOUT', 40, 650, 22), item('The reply is another ordinary line.', 40, 630), item('GUIDE', 40, 600, 22), item('Another body line follows.', 40, 580)]);
  assert.ok(result.blocks.some(b => b.role === 'speech' && b.speaker === 'GUIDE'));
  assert.ok(structureLines(result).filter(l => l.contentsEligible).every(l => !/GUIDE|SCOUT/.test(l.text))); valid(result);
});

test('whitespace mapping is deterministic and records transformations', () => {
  const items = [item('  Some\t text 😀 and ﬁ.  ', 40, 700), item('   ', 100, 680), item('', 100, 660)];
  const result = layout(items); valid(result);
  assert.deepEqual(result, layout(items)); assert.equal(text(result), 'Some text 😀 and ﬁ.');
  assert.ok(result.projection.segments.some(s => s.transform));
  const offset = text(result).indexOf('😀'); const source = sourceAt(result.projection, offset);
  assert.equal(offsetForSource(result.projection, source), offset);
});

test('nonzero origin, reversible viewport and rotated text have explicit fallback', () => {
  const result = interpretPage({ items: [item('Rotated example', 50, 700)] }, {
    view: [20, 30, 620, 830], viewport: { width: 800, height: 600, transform: [0, 1, 1, 0, -30, -20] },
  });
  assert.deepEqual(inversePoint(result.viewportTransform, 670, 30), [50, 700]);
  assert.equal(result.blocks[0].role, 'unknown'); assert.ok(result.fallbacks.length); valid(result);
});

test('installed PDF.js preserves a cropped rotated page and direction fallback', async () => {
  const task = getDocument({ data: makeLayoutPdf([{ view: [20, 30, 620, 830], rotate: 90, items: [{ text: 'A rotated source line.', x: 50, y: 700 }] }]), verbosity: 0 });
  try {
    const result = await readPageLayout(await task.promise, 1);
    assert.equal(result.rotation, 90); assert.equal(result.width, 800); assert.equal(result.height, 600);
    assert.deepEqual(inversePoint(result.viewportTransform, 670, 30), [50, 700]);
    assert.ok(result.fallbacks.length); valid(result);
  } finally { await task.destroy(); }
  const rtl = layout([item('אבג', 40, 700, 10, 30, { dir: 'rtl' })]);
  assert.equal(rtl.blocks[0].role, 'unknown'); assert.equal(rtl.runs[0].dir, 'rtl'); valid(rtl);
});

test('valid tags map marked IDs, partial and reversed tags fall back predictably', () => {
  const items = [{ type: 'beginMarkedContentProps', id: 'p0_mcid0' }, item('A tagged heading', 40, 700), { type: 'endMarkedContent' },
    { type: 'beginMarkedContentProps', id: 'p0_mcid1' }, item('A body paragraph.', 40, 660), { type: 'endMarkedContent' }];
  const tree = { role: 'Document', children: [{ role: 'H1', children: [{ type: 'content', id: 'p0_mcid0' }] }, { role: 'P', children: [{ type: 'content', id: 'p0_mcid1' }] }] };
  const options = { structTree: tree };
  const result = interpretPage({ items }, options); assert.equal(result.tags.status, 'validated'); assert.equal(result.blocks[0].role, 'heading'); valid(result);
  assert.equal(interpretPage({ items }, { structTree: { ...tree, children: tree.children.slice(1) } }).tags.status, 'rejected');
  assert.equal(interpretPage({ items }, { structTree: { ...tree, children: [...tree.children].reverse() } }).tags.status, 'rejected');
});

test('real PDF.js parses original lowered cap, columns, plays, tags and source maps', async () => {
  const task = getDocument({ data: makeLayoutPdf(layoutPages), isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    for (let page = 1; page <= pdf.numPages; page++) valid((await extractPage(pdf, page)).layout);
    const data = await extractPage(pdf, 1); assert.match(text(data.layout), /My goal/); assert.match(data.legacy.text, /inexpensive M high-quality/);
    const structure = await analyzeDocumentStructure(pdf);
    assert.ok(![...structure.nodes, ...structure.candidates].some(n => /goal|high-quality/.test(n.title)));
    const play = (await extractPage(pdf, 3)).layout;
    assert.ok(play.blocks.some(b => b.role === 'speech' && b.speaker === 'TRAVELLER'));
    assert.ok(play.blocks.some(b => b.role === 'stage-direction'));
    assert.match(text(play), /25 miles/); assert.ok(!/FTLN/.test(text(play)));
    assert.ok(play.annotations.some(a => a.projection.text === 'FTLN 0001'));
    const counter = play.annotations.find(a => a.projection.text === 'FTLN 0001');
    assert.match(play.lines.find(l => l.id === counter.associatedLine).text, /We walk/);
    assert.ok(play.annotations.some(a => a.projection.text === '5'));
    const offset = data.legacy.text.indexOf('goal');
    const migrated = resolveReadingPosition(data, { page: 1, offset });
    assert.equal(text(data.layout).slice(migrated.offset, migrated.offset + 4), 'goal');
    assert.equal(migrated.legacyOffset, offset);
    assert.deepEqual(resolveReadingPosition(data, migrated), migrated);
    const removedTitleOffset = offset - 'Preface\n\n'.length;
    assert.equal(resolveReadingPosition(data, { offset: removedTitleOffset }, 'Preface').offset, migrated.offset);
    const beginning = resolveReadingPosition(data, { page: 1, offset: 0 }, 'Preface');
    assert.ok(beginning.offset > 0, 'legacy zero after a removed title maps to its source, not the new heading');
  } finally { await task.destroy(); }
});

for (const badTags of [false, true]) test(`installed PDF.js marked-content structure mapping (bad=${badTags})`, async () => {
  const task = getDocument({ data: makeLayoutPdf([{ items: [{ text: 'A real tagged heading', x: 40, y: 700, role: 'H1' }, { text: 'Original body text.', x: 40, y: 660 }] }], { tagged: true, badTags }), verbosity: 0 });
  try {
    const result = await readPageLayout(await task.promise, 1);
    assert.equal(result.tags.status, badTags ? 'rejected' : 'validated');
    assert.ok(result.runs.filter(r => r.text.trim()).every(r => r.markedIds.some(id => /_mc\d+/.test(id)))); valid(result);
  } finally { await task.destroy(); }
});

test('pagination conserves exact intervals, structure and Unicode with safe oversized fallback', () => {
  const result = layout([item('😀'.repeat(40), 40, 700), item('Next meaningful line.', 60, 680)]);
  const fragments = paginateLayout(result, slice => slice.length <= 17);
  assert.equal(fragments.map(f => f.text).join(''), text(result));
  assert.ok(fragments.every((f, i) => !i || fragments[i - 1].end === f.start));
  for (const f of fragments) assert.ok(!/[\uD800-\uDBFF]$/.test(f.text));
  const slices = fragments.flatMap(f => layoutSlice(result, f.start, f.end));
  assert.ok(slices.some(b => b.continued));
  assert.ok(paginateLayout(result, () => false).every(f => f.kind === 'overflow'));
});

test('pagination backs a trailing speaker onto the next leaf and still fits', () => {
  const result = layout([item('ACT I', 250, 740, 18), item('GUIDE An opening statement.', 40, 700), item('SCOUT', 40, 680), item('A response follows here.', 40, 660), item('GUIDE The last reply.', 40, 640)]);
  const label = text(result).indexOf('SCOUT');
  const limit = label + 'SCOUT'.length + 1;
  const fragments = paginateLayout(result, slice => slice.length <= limit);
  assert.equal(fragments[0].end, label);
  assert.ok(fragments.every(f => f.text.length <= limit));
  assert.equal(fragments.map(f => f.text).join(''), text(result));
});

test('shared layout cache is bounded, reuses pending work and allows independent cancellation', async () => {
  let reads = 0;
  const pdf = { numPages: 1000, getPage: async () => { reads++; return { view: [0, 0, 600, 800], getTextContent: async () => ({ items: [item('Original text.', 40, 700)] }) }; } };
  const controller = new AbortController();
  const pending = readPageLayout(pdf, 1, { signal: controller.signal });
  const second = readPageLayout(pdf, 1); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); await second; assert.equal(reads, 1);
  for (let n = 2; n <= 1000; n++) await readPageLayout(pdf, n);
  assert.equal(reads, 1000); await readPageLayout(pdf, 1); assert.equal(reads, 1001);
  clearPageLayouts(pdf); await readPageLayout(pdf, 1000); assert.equal(reads, 1002);
});
