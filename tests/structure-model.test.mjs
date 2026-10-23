import test from 'node:test';
import assert from 'node:assert/strict';
import { structureFromLegacy, structureNodes, structurePath, activeStructureNode, chaptersFromNodes, createStructureScanner, shouldAutoScanStructure } from '../src/structure-model.js';

const nodes = [
  { id: 'part', title: 'Part I', kind: 'part', page: 3, parentId: null, source: 'headings' },
  { id: 'chapter', title: 'Chapter 1', kind: 'chapter', page: 3, parentId: 'part', source: 'headings' },
  { id: 'section', title: '1.1 Events', kind: 'section', page: 3, y: 400, parentId: 'chapter', source: 'headings' },
];
test('only an explicit scan stop opts out of automatic upgrades', () => {
  assert.equal(shouldAutoScanStructure(undefined, 4), true);
  assert.equal(shouldAutoScanStructure({status:'complete',version:4},4),false);
  assert.equal(shouldAutoScanStructure({status:'complete',version:3},4),true);
  assert.equal(shouldAutoScanStructure({status:'cancelled',version:3},4),false);
  assert.equal(shouldAutoScanStructure({status:'manual',version:4},4),true);
});
test('automatic same-page hierarchy, selection and typography stay intact', () => {
  const result=structureNodes({nodes,totalPages:200});
  assert.equal(result.length,3);
  assert.deepEqual(structurePath(result,'section').map(n=>n.id),['part','chapter','section']);
  assert.equal(activeStructureNode(result,3).id,'chapter');
  assert.equal(activeStructureNode(result,3,'section').id,'section');
  assert.deepEqual(chaptersFromNodes(result).map(n=>n.title),['Opening pages','Chapter 1']);
  assert.equal(nodes[0].title,'Part I');
});
test('legacy automatic chapters remain readable while awaiting a scan', () => {
  const legacy=structureFromLegacy([{title:'Opening',page:1}],200);
  assert.equal(legacy.status,'pending'); assert.equal(legacy.nodes[0].source,'legacy');
});
test('retired custom nodes cannot enter automatic Contents', () => {
  const result=structureNodes({nodes:[...nodes,{id:'custom',title:'Old note',page:3,source:'manual'}],totalPages:200});
  assert.deepEqual(result.map(n=>n.id),['part','chapter','section']);
});
test('invalid pages and cycles cannot break automatic Contents', () => {
  const result=structureNodes({nodes:[{...nodes[1],parentId:'section'},nodes[2],{id:'invalid',title:'Bad',page:999}],totalPages:200});
  assert.ok(!result.some(n=>n.id==='invalid'));
  assert.ok(structurePath(result,'section').length<=2);
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
