import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocumentStructure, STRUCTURE_VERSION } from '../src/document-structure.js';

const item = (str, x, y, size = 17) => ({ str, width: str.length * size * .45, transform: [size, 0, 0, size, x, y] });
function pdf(pages, { outline = [], labels } = {}) {
  return { numPages: pages.length, getOutline: async () => outline, getPageLabels: async () => labels,
    getPage: async (number) => ({ view: [0, 0, 720, 917], getTextContent: async () => ({ items: pages[number - 1] }) }) };
}
const opening = (act, scene = '1') => [item(`ACT ${act}`, 265, 898, 21), item(`Scene ${scene}`, 268, 816),
  item('Enter two travellers.', 180, 796), item('Their conversation begins here.', 80, 756)];

test('body-sized scenes survive repeated labels, Roman numbering, top-edge acts and same-page boundaries', async () => {
  const first = [...opening('I', 'I'), item('ACT II', 265, 600, 21), item('Scene I', 268, 518),
    item('Enter another traveller.', 180, 498), item('A speech follows.', 80, 458)];
  const second = [item('ACT II. SC. II', 450, 877, 11), item('The previous speech ends.', 80, 560),
    item('Scene II', 268, 500), item('Enter the travellers.', 180, 480), item('They speak.', 80, 440)];
  const result = await analyzeDocumentStructure(pdf([first, second, opening('III', 'I')]));
  const acts = result.nodes.filter((node) => /^Act /.test(node.title));
  const scenes = result.nodes.filter((node) => /^Scene /.test(node.title));
  assert.deepEqual(acts.map((node) => [node.title, node.page, node.y, node.kind]), [
    ['Act I', 1, 898, 'part'], ['Act II', 1, 600, 'part'], ['Act III', 3, 898, 'part'],
  ]);
  assert.deepEqual(scenes.map((node) => [node.title, node.page, node.parentId, node.kind]), [
    ['Scene I', 1, acts[0].id, 'chapter'], ['Scene I', 1, acts[1].id, 'chapter'],
    ['Scene II', 2, acts[1].id, 'chapter'], ['Scene I', 3, acts[2].id, 'chapter'],
  ]);
  assert.equal(new Set(scenes.map((node) => node.id)).size, 4);
  assert.ok(result.nodes.every((node) => !/SC\.|Enter|speech/.test(node.title)));
});

test('bare play labels on a Contents page never become false page references or openings', async () => {
  const contents = [item('Contents', 260, 898, 21), item('ACT 1', 80, 740, 19), item('Scene 1', 218, 700),
    item('Scene 2', 218, 680), item('ACT 1 Scene 3', 80, 660), item('ACT 2. SC. 1', 80, 620)];
  const result = await analyzeDocumentStructure(pdf([contents, opening(1), opening(2)]));
  assert.equal(result._tocEvidence.length, 0);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.nodes.filter((node) => node.source !== 'fallback').every((node) => node.page > 1));
});

test('numbered dialogue, poetry, prose and aligned numeric tables cannot establish Contents', async () => {
  const dialogue = [item('ACT 1. SC. 2', 450, 877, 11)];
  for (let i = 0; i < 20; i++) {
    const y = 810 - i * 25;
    dialogue.push(item(`SPEAKER A line of verse ${i === 4 ? '… with more words' : 'spoken aloud'}`, 80, y));
    if (i % 5 === 4) dialogue.push(item(String(i + 1), 600, y));
  }
  const table = [item('Results', 80, 850, 17), ...['Apples', 'Pears', 'Oranges', 'Plums'].flatMap((name, i) => [
    item(name, 80, 780 - i * 30), item(String(i + 10), 350, 780 - i * 30), item(String(i + 20), 600, 780 - i * 30),
  ])];
  const twoColumnTable = ['Apples', 'Pears', 'Oranges', 'Plums'].flatMap((name, i) => [item(name, 80, 780 - i * 30), item(String(i + 1), 600, 780 - i * 30)]);
  const prose = Array.from({ length: 8 }, (_, i) => item(`A complete prose sentence ends here ${i + 1}`, 80, 780 - i * 25));
  const result = await analyzeDocumentStructure(pdf([dialogue, table, twoColumnTable, prose]));
  assert.equal(result._tocEvidence.length, 0);
  assert.deepEqual(result.nodes.map((node) => node.title), ['Entire book']);
  assert.deepEqual(result.candidates, []);
});

test('body-sized ambiguous labels stay reviewable without relaxing ordinary chapter thresholds', async () => {
  const result = await analyzeDocumentStructure(pdf([[item('Prior text.', 80, 760), item('Scene 2', 268, 740),
    item('Following text.', 80, 720), item('Chapter 3 Describes an example.', 80, 500), item('A paragraph follows.', 80, 480),
    item('Enter Scene 4.', 80, 400)]]));
  assert.deepEqual(result.nodes.map((node) => node.title), ['Entire book']);
  assert.ok(result.candidates.some((node) => node.title === 'Scene 2'));
  assert.ok(result.candidates.some((node) => node.title.includes('Describes an example')));
});

test('review identities distinguish same-page repeated scenes and deduplicate repeated ordinary TOC entries', async () => {
  const result = await analyzeDocumentStructure(pdf([
    [item('Prior text.', 80, 800), item('Scene 1', 268, 740), item('Enter one traveller.', 80, 720),
      item('Scene 1', 268, 500), item('Enter another traveller.', 80, 480)],
    [item('Contents', 260, 898, 21), item('Chapter 3: Missing .... 9', 80, 700)],
    [item('Contents', 260, 898, 21), item('Chapter 3: Missing .... 9', 80, 700)],
  ]));
  const scenes = result.candidates.filter((node) => node.title === 'Scene 1');
  assert.equal(scenes.length, 2);
  assert.notEqual(scenes[0].id, scenes[1].id);
  assert.equal(result.candidates.filter((node) => node.title.includes('Missing')).length, 1);
  assert.equal(result.tocUnresolved, 1);
});

test('repeated standalone margin labels and backwards ordinals do not supply play-opening evidence', async () => {
  const running = Array.from({ length: 6 }, (_, i) => [item(`ACT ${i < 3 ? 1 : 2}`, 265, 898, 17),
    item('Ordinary body text follows the running title.', 80, 816), item('The paragraph continues.', 80, 796)]);
  const result = await analyzeDocumentStructure(pdf(running));
  assert.deepEqual(result.nodes.map((node) => node.title), ['Entire book']);
  assert.deepEqual(result.candidates, []);
  const reverse = await analyzeDocumentStructure(pdf([
    [item('Prior prose.', 80, 800), item('Scene 3', 268, 740), item('Enter a traveller.', 180, 720)],
    [item('Prior prose.', 80, 800), item('Scene 2', 268, 740), item('Enter another traveller.', 180, 720)],
  ]));
  assert.deepEqual(reverse.nodes.map((node) => node.title), ['Entire book']);
});

test('Contents rows and a separate real opening may share a page', async () => {
  const mixed = [item('Contents', 260, 898, 21), item('Chapter 1: Elsewhere', 80, 780), item('2', 600, 780),
    item('ACT I', 265, 600, 21), item('Scene I', 268, 518), item('Enter two travellers.', 180, 498), item('They speak.', 80, 458)];
  const result = await analyzeDocumentStructure(pdf([mixed, [item('Chapter 1: Elsewhere', 80, 780, 25), item('Prose.', 80, 730)]]));
  assert.ok(result.nodes.some((node) => node.title === 'Act I' && node.page === 1));
  assert.ok(result.nodes.some((node) => node.title === 'Scene I' && node.page === 1));
  assert.ok(!result.nodes.some((node) => /Elsewhere/.test(node.title) && node.page === 1));
});

test('unlabelled aligned numbered Contents continues to resolve using page labels', async () => {
  const result = await analyzeDocumentStructure(pdf([
    [1, 2, 3].flatMap((number, i) => [item(`Chapter ${number}: Topic ${number}`, 80, 780 - i * 30), item(String(number), 600, 780 - i * 30)]),
    ...[1, 2, 3].map((number) => [item(`Chapter ${number}: Topic ${number}`, 80, 780, 25), item('Prose.', 80, 730)]),
  ], { labels: ['i', '1', '2', '3'] }));
  assert.equal(result._tocEvidence.length, 3);
  assert.deepEqual(result.nodes.filter((node) => node.source === 'toc').map((node) => node.page), [2, 3, 4]);
});

test('offset-derived candidates are range checked and duplicated anchors cannot establish an offset', async () => {
  const contents = [item('Contents', 260, 898, 21), item('Chapter 1: First .... 2', 80, 780),
    item('Chapter 2: Second .... 3', 80, 750), item('Chapter 3: Missing .... 999', 80, 720)];
  const result = await analyzeDocumentStructure(pdf([contents, [],
    [item('Chapter 1: First', 80, 780, 25), item('Prose.', 80, 730)],
    [item('Chapter 2: Second', 80, 780, 25), item('Prose.', 80, 730)]]));
  assert.equal(result.candidates.find((node) => /Missing/.test(node.title)).page, null);
  assert.ok([...result.nodes, ...result.candidates].every((node) => node.page == null || node.page >= 1 && node.page <= 4));
  const duplicate = await analyzeDocumentStructure(pdf([contents.slice(0, 2), contents.slice(0, 2),
    [item('Chapter 1: First', 80, 780, 25), item('Prose.', 80, 730)]]));
  assert.ok(duplicate.candidates.some((node) => /First/.test(node.title) && node.source === 'toc' && node.page == null));
  assert.ok(!duplicate.nodes.some((node) => node.source === 'toc'));
});

test('coordinate-less outline parents precede scanned children without losing positioned boundaries', async () => {
  const result = await analyzeDocumentStructure(pdf([
    [item('Chapter 1: Before', 80, 780, 25), item('Prose.', 80, 730),
      item('Chapter 2: After', 80, 400, 25), item('More prose.', 80, 350)],
  ], { outline: [{ title: 'Part One', dest: [0, { name: 'Fit' }] }, { title: 'Part Two', dest: [0, { name: 'XYZ' }, null, 500] }] }));
  const first = result.nodes.find((node) => node.title === 'Part One');
  const second = result.nodes.find((node) => node.title === 'Part Two');
  assert.equal(result.nodes.find((node) => /Before/.test(node.title)).parentId, first.id);
  assert.equal(result.nodes.find((node) => /After/.test(node.title)).parentId, second.id);
});

test('legacy Part, Chapter and decimal-section IDs remain exactly unchanged', async () => {
  const text = (str, y, size = 10) => item(str, 30, y, size);
  const doc = pdf([[], [text('Chapter 1: Arrival', 720, 20), text('Text.', 680)],
    [text('1.1 First section', 720, 18), text('Text.', 680)]], { outline: [{ title: 'Part One', dest: [0] }] });
  const result = await analyzeDocumentStructure(doc);
  assert.deepEqual(result.nodes.map((node) => [node.title, node.id]), [
    ['Part One', 'structure-1as19cs'], ['Chapter 1: Arrival', 'structure-15kpdsy'], ['1.1: First section', 'structure-gbzu3z'],
  ]);
});

test('the analyzer discards all stale checkpoint evidence and rescans every page itself', async () => {
  const doc = pdf([opening(1), opening(2)]); const fetched = [];
  const original = doc.getPage; doc.getPage = async (number) => { fetched.push(number); return original(number); };
  const stale = { version: STRUCTURE_VERSION - 1, totalPages: 2, nodes: [], candidates: [], scannedPages: [1, 2], failedPages: [], textPages: 999,
    _headingEvidence: [{ title: 'Stale poison', page: 1, y: 400, size: 30, median: 10, explicit: true, evidence: [] }],
    _tocEvidence: [{ title: 'Poison', label: '999', tocPage: 1 }], _baseCandidates: [{ id: 'poison', title: 'Poison', evidence: [] }] };
  const result = await analyzeDocumentStructure(doc, { initial: stale });
  assert.deepEqual(fetched, [1, 2]);
  assert.equal(result.version, 2);
  assert.equal(result.textPages, 2);
  assert.equal(result._tocEvidence.length, 0);
  assert.ok([...result.nodes, ...result.candidates].every((node) => !/poison/i.test(node.title)));
});
