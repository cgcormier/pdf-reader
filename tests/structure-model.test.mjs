import test from 'node:test';
import assert from 'node:assert/strict';
import { structureFromLegacy, structureNodes, structurePath, activeStructureNode, chaptersFromNodes, createStructureScanner, shouldAutoScanStructure } from '../src/structure-model.js';
import { analyzeDocumentStructure, STRUCTURE_VERSION } from '../src/document-structure.js';

test('automatic scan policy upgrades completed snapshots while respecting explicit opt-outs', () => {
  assert.equal(shouldAutoScanStructure(undefined, 2), true);
  assert.equal(shouldAutoScanStructure({ status: 'complete', version: 1 }, 2), true);
  assert.equal(shouldAutoScanStructure({ status: 'complete', version: 2 }, 2), false);
  assert.equal(shouldAutoScanStructure({ status: 'complete' }, 2), true);
  for (const version of [1, 2]) {
    for (const status of ['manual', 'cancelled']) assert.equal(shouldAutoScanStructure({ status, version }, 2), false);
    for (const status of ['pending', 'scanning', 'error']) assert.equal(shouldAutoScanStructure({ status, version }, 2), true);
  }
});

test('detector upgrades preserve existing IDs, corrections, accepted suggestions, and reading anchors', async () => {
  const item = (str, y, size = 10) => ({ str, width: str.length * size * .5, transform: [size, 0, 0, size, 30, y], hasEOL: false });
  const pdf = {
    numPages: 4, getOutline: async () => [], getPageLabels: async () => null,
    getPage: async n => ({ view: [0, 0, 600, 800], getTextContent: async () => ({ items:
      n === 1 ? [item('Part I: Learning', 730, 24), item('Chapter 1: Start', 670, 20), item('Text.', 620)]
        : n === 2 ? [item('1.1 Details', 720, 18), item('Text.', 670)]
          : n === 3 ? [item('Chapter 2: Next', 720, 20), item('Text.', 670)]
            : [item('Section 9: Optional', 650), item('Text.', 610)],
    }) }),
  };
  // IDs recorded from the version-1 detector for this self-contained fixture.
  const ids = { part: 'structure-nussij', first: 'structure-1swx11k', section: 'structure-1jzzr4j', second: 'structure-84x8t3', accepted: 'structure-hoeucl' };
  const snapshot = await analyzeDocumentStructure(pdf);
  assert.equal(snapshot.version, STRUCTURE_VERSION);
  for (const id of [ids.part, ids.first, ids.section, ids.second]) assert.ok(snapshot.nodes.some(node => node.id === id), `preserves ${id}`);
  assert.ok(snapshot.candidates.some(node => node.id === ids.accepted));
  const book = {
    structure: { ...snapshot, version: 1 },
    structureEdits: {
      [ids.first]: { ...snapshot.nodes.find(node => node.id === ids.first), title: 'My opening' },
      [ids.second]: { hidden: true },
      [ids.section]: { ...snapshot.nodes.find(node => node.id === ids.section), parentId: ids.part },
      [ids.accepted]: { ...snapshot.candidates.find(node => node.id === ids.accepted), hidden: false },
      custom: { title: 'My note', page: 4, kind: 'heading', parentId: ids.part },
    },
    bookPosition: { page: 2, offset: 845, contentsId: ids.section },
    scrollPosition: { page: 2, fraction: .45, view: 'book' },
  };
  const saved = structuredClone(book);
  book.structure = await analyzeDocumentStructure(pdf);
  const result = structureNodes(book.structure, book.structureEdits);
  assert.equal(result.find(node => node.id === ids.first).title, 'My opening');
  assert.equal(result.some(node => node.id === ids.second), false);
  assert.equal(result.find(node => node.id === ids.section).parentId, ids.part);
  assert.equal(result.filter(node => node.id === ids.accepted).length, 1);
  assert.equal(result.find(node => node.id === 'custom').parentId, ids.part);
  assert.deepEqual(book.structureEdits, saved.structureEdits);
  assert.deepEqual(book.bookPosition, saved.bookPosition);
  assert.deepEqual(book.scrollPosition, saved.scrollPosition);
  assert.equal(activeStructureNode(result, 2, book.bookPosition.contentsId).id, ids.section);
});

test('accepted suggestions retain their ID when a unique matching heading becomes confident', () => {
  const automatic = { id: 'detected', title: 'Scene 1', page: 3, y: 700, kind: 'chapter', parentId: null, source: 'headings' };
  const child = { id: 'child', title: 'A detail', page: 3, y: 650, kind: 'section', parentId: automatic.id, source: 'headings' };
  const edits = { accepted: { ...automatic, id: 'accepted', confidence: 'low' } };
  const result = structureNodes({ nodes: [automatic, child], totalPages: 4 }, edits);
  assert.equal(result.some(node => node.id === 'detected'), false);
  assert.equal(result.filter(node => node.title === 'Scene 1').length, 1);
  assert.equal(result.find(node => node.id === 'child').parentId, 'accepted');
  assert.equal(result.find(node => node.id === 'accepted').source, 'manual');
});

test('overlay reconciliation preserves distinct or ambiguous same-page scenes', () => {
  const scene = { title: 'Scene 1', page: 3, kind: 'chapter', parentId: null, source: 'headings' };
  const automatic = [{ ...scene, id: 'upper', y: 700 }, { ...scene, id: 'lower', y: 300 }];
  const uncertain = structureNodes({ nodes: automatic, totalPages: 4 }, { accepted: { ...scene, y: null } });
  assert.equal(uncertain.length, 3, 'a page-only correction cannot choose between two scene starts');
  const positioned = structureNodes({ nodes: automatic, totalPages: 4 }, { accepted: { ...scene, y: 700 } });
  assert.deepEqual(positioned.map(node => node.id), ['accepted', 'lower']);
});

const nodes = [
  { id: 'part', title: 'Part I', kind: 'part', page: 3, parentId: null },
  { id: 'chapter', title: 'Chapter 1', kind: 'chapter', page: 3, parentId: 'part' },
  { id: 'section', title: '1.1 Events', kind: 'section', page: 3, y: 400, parentId: 'chapter' },
];
test('legacy manual arrangements survive, and overlays preserve changes across a new scan', () => {
  const legacy = structureFromLegacy([{ title: 'My opening', page: 1 }], 200, true);
  assert.equal(legacy.status, 'manual');
  assert.equal(legacy.nodes[0].source, 'manual');
  const structure = { nodes, totalPages: 200 };
  const edits = { chapter: { title: 'My chapter', page: 8 }, section: { hidden: true }, custom: { title: 'Notes', page: 180, kind: 'appendix', parentId: null } };
  const result = structureNodes(structure, edits);
  assert.equal(result.find(node => node.id === 'chapter').title, 'My chapter');
  assert.equal(result.some(node => node.id === 'section'), false);
  assert.equal(result.at(-1).source, 'manual');
  assert.equal(nodes[1].page, 3, 'base detection remains untouched');
});
test('same-page hierarchy survives and navigation highlights a selected section or a conservative chapter', () => {
  const result = structureNodes({ nodes, totalPages: 200 });
  assert.equal(result.length, 3);
  assert.deepEqual(structurePath(result, 'section').map(node => node.id), ['part', 'chapter', 'section']);
  assert.equal(activeStructureNode(result, 3).id, 'chapter');
  assert.equal(activeStructureNode(result, 3, 'section').id, 'section');
  assert.deepEqual(chaptersFromNodes(result).map(node => node.title), ['Opening pages', 'Chapter 1']);
});
test('rescanning an older manual arrangement preserves its names without duplicate automatic chapters', () => {
  const result = structureNodes({ nodes, totalPages: 200 }, { 'legacy-0': { title: 'My title', page: 3, kind: 'chapter', parentId: null } });
  assert.equal(result.filter(node => node.kind === 'chapter' && node.page === 3).length, 1);
  assert.equal(result.find(node => node.kind === 'chapter').title, 'My title');
  assert.ok(result.some(node => node.kind === 'part'), 'part remains separate on same page');
  assert.equal(result.find(node => node.kind === 'section').parentId, 'legacy-0');
});
test('hidden parents, invalid pages and parent cycles cannot break the contents tree', () => {
  const result = structureNodes({ nodes, totalPages: 200 }, { part: { hidden: true }, chapter: { parentId: 'section' }, invalid: { title: 'Bad', page: 999 } });
  assert.equal(result.some(node => node.id === 'invalid'), false);
  assert.ok(result.some(node => node.parentId === null));
  assert.ok(structurePath(result, 'section').length <= 2);
});
test('old scan callbacks and failures cannot replace the new scan after a switch', async () => {
  const jobs = [];
  const updates = [];
  const scanner = createStructureScanner((pdf, options) => new Promise((resolve, reject) => jobs.push({ pdf, options, resolve, reject })), { onUpdate: value => updates.push(value) });
  const first = scanner.start('old', {});
  const second = scanner.start('new', {});
  assert.equal(jobs[0].options.signal.aborted, true);
  jobs[0].options.onUpdate('stale'); jobs[0].resolve('stale final');
  jobs[1].options.onUpdate('current'); jobs[1].resolve('current final');
  await Promise.all([first, second]);
  assert.deepEqual(updates, ['current', 'current final']);
  assert.equal(scanner.running, false);
});
test('cancel is silent and cannot publish a final result after cancellation', async () => {
  let finish;
  const updates = [];
  const scanner = createStructureScanner(() => new Promise(resolve => { finish = resolve; }), { onUpdate: result => updates.push(result) });
  const pending = scanner.start({}, {});
  scanner.cancel(); finish('late'); await pending;
  assert.deepEqual(updates, []);
});
