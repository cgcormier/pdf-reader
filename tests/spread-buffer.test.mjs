import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpreadBuffer } from '../src/spread-buffer.js';

const anchor = page => ({ page, offset: 0 });
const spread = (page, nodes = 5) => ({ spread: { anchor: anchor(page) }, pages: [{ querySelectorAll: () => Array(nodes - 1) }] });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('foreground turns share a pending preparation with speculative work', async () => {
  const pending = deferred(); let calls = 0;
  const buffer = createSpreadBuffer({ prepare: () => { calls++; return pending.promise; } });
  const warm = buffer.get(anchor(1));
  const foreground = buffer.get(anchor(1));
  assert.equal(warm, foreground);
  const value = spread(1); pending.resolve(value);
  assert.equal(await foreground, value);
  assert.equal(calls, 1);
  assert.equal(await buffer.get(anchor(1)), value);
});

test('previous/current/next reuse is bounded and evicts the least recently used spread', async () => {
  const loads = [];
  const buffer = createSpreadBuffer({ prepare: async ({ page }) => { loads.push(page); return spread(page); } });
  const first = await buffer.get(anchor(1));
  await buffer.get(anchor(2)); await buffer.get(anchor(3));
  assert.equal(await buffer.get(anchor(1)), first);
  await buffer.get(anchor(4));
  assert.equal(buffer.size, 3); assert.equal(buffer.nodeCount, 15);
  await buffer.get(anchor(2));
  assert.deepEqual(loads, [1, 2, 3, 4, 2]);
});

test('a DOM node budget evicts complex spreads and never retains an oversized one', async () => {
  let calls = 0;
  const buffer = createSpreadBuffer({ maxNodes: 10, prepare: async ({ page }) => { calls++; return spread(page, page === 3 ? 25 : 6); } });
  await buffer.get(anchor(1)); await buffer.get(anchor(2));
  assert.equal(buffer.size, 1); assert.equal(buffer.nodeCount, 6);
  assert.equal((await buffer.get(anchor(3))).spread.anchor.page, 3);
  assert.equal(buffer.size, 1); assert.equal(buffer.nodeCount, 6);
  await buffer.get(anchor(3)); assert.equal(calls, 4);
});

test('failed preparation is retryable and clearing isolates an old pending result', async () => {
  const jobs = [deferred(), deferred(), deferred()]; let call = 0;
  const buffer = createSpreadBuffer({ prepare: () => jobs[call++].promise });
  const failed = buffer.get(anchor(1)); jobs[0].reject(new Error('try again'));
  await assert.rejects(failed, /try again/); assert.equal(buffer.size, 0);
  const old = buffer.get(anchor(1)); await Promise.resolve();
  buffer.clear();
  const fresh = buffer.get(anchor(1)); await Promise.resolve();
  const current = spread(1); jobs[2].resolve(current); await fresh;
  jobs[1].resolve(spread(1, 300)); await old;
  assert.equal(await buffer.get(anchor(1)), current);
  assert.equal(buffer.nodeCount, 5);
});

test('normalized reading anchors count the same DOM pages only once', async () => {
  const value = spread(1);
  const buffer = createSpreadBuffer({ prepare: async () => value });
  await buffer.get({ page: 1, offset: 40 });
  buffer.remember(anchor(1), value);
  assert.equal(buffer.size, 1); assert.equal(buffer.nodeCount, 5);
  assert.equal(await buffer.get(anchor(1)), value);
  buffer.clear(); assert.equal(buffer.size, 0); assert.equal(buffer.nodeCount, 0);
});
