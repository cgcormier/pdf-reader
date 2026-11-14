import test from 'node:test';
import assert from 'node:assert/strict';
import { indexContents, filterContents } from '../src/contents-navigation.js';

const nodes = [
  { id: 'part', parentId: null, title: 'Part One' },
  { id: 'chapter', parentId: 'part', title: 'Chapter One' },
  { id: 'section', parentId: 'chapter', title: 'An Exact Destination' },
  { id: 'sibling', parentId: 'part', title: 'Something Else' },
  { id: 'other', parentId: null, title: 'Other Destination' },
];

test('title filtering retains all ancestors and excludes unrelated descendants', () => {
  const index = indexContents(nodes);
  const result = filterContents(index, '  dESTination  ');
  assert.deepEqual([...result.matches], ['section', 'other']);
  assert.deepEqual([...result.visible], ['section', 'chapter', 'part', 'other']);
  assert.deepEqual([...filterContents(index, 'Part').visible], ['part']);
  assert.equal(result.filtering, true);
  assert.deepEqual(index.children.get('part'), [nodes[1], nodes[3]]);
});

test('clearing and no-match filtering preserve normalized nodes and index ordering', () => {
  const before = structuredClone(nodes);
  const index = indexContents(nodes);
  assert.equal(filterContents(index, 'missing').visible.size, 0);
  assert.equal(filterContents(index, '  ').filtering, false);
  assert.equal(filterContents(index, '').visible.size, nodes.length);
  assert.deepEqual(index.children.get(null), [nodes[0], nodes[4]]);
  assert.deepEqual(nodes, before);
  assert.equal(filterContents(indexContents([]), 'anything').matches.size, 0);
});

test('large nested and broad outlines retain one indexed entry per destination', () => {
  const large = Array.from({ length: 10000 }, (_, i) => ({
    id: `node-${i}`, parentId: i && i < 200 ? `node-${i - 1}` : null,
    title: i === 199 ? 'Needle' : `Heading ${i}`,
  }));
  const index = indexContents(large);
  const result = filterContents(index, 'needle');
  assert.equal(result.matches.size, 1);
  assert.equal(result.visible.size, 200);
  assert.equal(index.byId.size, large.length);
  assert.equal(filterContents(index, 'heading').visible.size, 9999);
});
