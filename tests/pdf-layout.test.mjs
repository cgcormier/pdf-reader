import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretPage, conservation, structureLines, inversePoint, sourceAt, offsetForSource, layoutSlice } from '../src/pdf-layout.js';
import { resolveReadingPosition, paginateLayout } from '../src/layout-reading.js';
import { extractPage } from '../src/pdf-engine.js';
import { readPageLayout, clearPageLayouts } from '../src/pdf-layout-adapter.js';
import { analyzeDocumentStructure } from '../src/document-structure.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeLayoutPdf, layoutPages } from './pdf-layout-fixture.mjs';

const item = (str, x, y, size = 10, width = str.length * size * .45, extra = {}) => ({ str, width, transform: [size, 0, 0, size, x, y], ...extra });
const layout = items => interpretPage({ items });
const text = l => l.projection.text;
const valid = l => assert.deepEqual(conservation(l), { valid: true, errors: [] });
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

test('indent changes, paragraph gaps and centered headings remain explicit', () => {
  const result = layout([item('Opening prose is reflowable.', 40, 700, 10, 440), item('Continuation also reflows.', 40, 686, 10, 430),
    item('An indented new paragraph.', 60, 660, 10, 400), item('Continuation at body margin.', 40, 646, 10, 440), item('Chapter 2', 230, 600, 18, 140)]);
  assert.ok(result.blocks.length >= 3); assert.ok(result.blocks.some(b => b.indent > 0)); valid(result);
});

test('neutral verse keeps source lines and stanza gaps without freezing prose', () => {
  const result = layout([item('Across the quiet road', 40, 700), item('We carry borrowed light', 60, 685), item('And wait beside the gate', 40, 670),
    item('Another stanza begins', 40, 630), item('A second line returns', 60, 615), item('The final line remains', 40, 600)].map(run => ({ ...run, hasEOL: true })));
  assert.ok(result.blocks.every(b => b.role === 'line-group'));
  assert.match(text(result), /Across the quiet road\n\nWe carry borrowed light/);
  assert.ok(result.blocks.some(b => b.indent > 0)); valid(result);
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
