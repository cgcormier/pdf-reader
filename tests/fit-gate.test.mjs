import test from 'node:test';
import assert from 'node:assert/strict';
import { createFitGate } from '../src/fit-gate.js';
import { createSpreadBuffer } from '../src/spread-buffer.js';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('fitting can proceed normally, pauses during a turn, and resumes afterwards', async () => {
  const gate = createFitGate();
  await gate.wait();
  const release = gate.pause();
  let finished = false;
  const fit = gate.wait().then(() => { finished = true; });
  await nextTurn();
  assert.equal(finished, false);
  release();
  await fit;
  assert.equal(finished, true);
  assert.equal(gate.paused, false);
});

test('a stale or duplicate release cannot resume work while another turn holds the gate', async () => {
  const gate = createFitGate();
  const first = gate.pause();
  const second = gate.pause();
  let resumed = false;
  const work = gate.wait().then(() => { resumed = true; });
  first(); first();
  await nextTurn();
  assert.equal(resumed, false);
  assert.equal(gate.paused, true);
  second();
  await work;
  assert.equal(gate.paused, false);
});

test('aborting one waiting fit does not strand or release other work', async () => {
  const gate = createFitGate();
  const release = gate.pause();
  const controller = new AbortController();
  const cancelled = gate.wait(controller.signal);
  let otherFinished = false;
  const other = gate.wait().then(() => { otherFinished = true; });
  const reason = new DOMException('Layout changed', 'AbortError');
  controller.abort(reason);
  await assert.rejects(cancelled, error => error === reason);
  await nextTurn();
  assert.equal(otherFinished, false);
  release();
  await other;
  assert.equal(otherFinished, true);
});

test('an already-aborted layout does not wait for an active turn', async () => {
  const gate = createFitGate();
  const release = gate.pause();
  const controller = new AbortController();
  const reason = new DOMException('Layout changed', 'AbortError');
  controller.abort(reason);
  await assert.rejects(gate.wait(controller.signal), error => error === reason);
  release();
});

test('a cancelled old layout cannot unblock a new layout', async () => {
  const oldGate = createFitGate();
  const newGate = createFitGate();
  const releaseOld = oldGate.pause();
  const releaseNew = newGate.pause();
  const oldController = new AbortController();
  const oldWork = oldGate.wait(oldController.signal);
  let newFinished = false;
  const newWork = newGate.wait().then(() => { newFinished = true; });
  oldController.abort();
  await assert.rejects(oldWork, { name: 'AbortError' });
  releaseOld();
  await nextTurn();
  assert.equal(newFinished, false);
  releaseNew();
  await newWork;
  assert.equal(newFinished, true);
});

test('an immediately finished turn leaves subsequent fitting unblocked', async () => {
  const gate = createFitGate();
  gate.pause()();
  assert.equal(gate.paused, false);
  await gate.wait();
});

test('foreground and speculative callers share a fit across an animation pause', async () => {
  const gate = createFitGate();
  const release = gate.pause();
  let calls = 0;
  const expected = { pages: [{ querySelectorAll: () => [] }] };
  const buffer = createSpreadBuffer({ prepare: async () => {
    calls++;
    await gate.wait();
    return expected;
  } });
  const anchor = { page: 2, offset: 0 };
  const speculative = buffer.get(anchor);
  const foreground = buffer.get(anchor);
  assert.equal(speculative, foreground);
  await nextTurn();
  assert.equal(calls, 1);
  release();
  assert.equal(await foreground, expected);
  assert.equal(await speculative, expected);
  assert.equal(calls, 1);
});
