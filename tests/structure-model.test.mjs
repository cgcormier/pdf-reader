import test from 'node:test';
import assert from 'node:assert/strict';
import { structureFromLegacy, structureNodes, structurePath, activeStructureNode, chaptersFromNodes, createStructureScanner } from '../src/structure-model.js';

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
