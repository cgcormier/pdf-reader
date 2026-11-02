import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { waitForAsync } from './browser-wait.mjs';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('an unresolved predicate and resolved false do not satisfy the wait', { timeout: 1000 }, async () => {
  const first = deferred(); const second = deferred(); const secondStarted = deferred(); let calls = 0; let finished = false;
  const page = { evaluate() { calls++; if (calls === 2) secondStarted.resolve(); return calls === 1 ? first.promise : second.promise; } };
  const result = waitForAsync(page, async () => false, undefined, { timeout: 500, interval: 1 }).then(value => { finished = true; return value; });
  await nextTurn(); assert.equal(calls, 1); assert.equal(finished, false);
  first.resolve(false);
  await secondStarted.promise;
  assert.equal(finished, false); assert.equal(calls, 2);
  await nextTurn(); assert.equal(calls, 2, 'evaluations must not overlap');
  second.resolve(true); assert.equal(await result, true);
});

test('returns the resolved truthy value and preserves predicate argument', async () => {
  const predicate = async expected => expected; const arg = { ready: true };
  const page = { async evaluate(actual, value) { assert.equal(actual, predicate); assert.equal(value, arg); return actual(value); } };
  assert.equal(await waitForAsync(page, predicate, arg), arg);
});

test('persistent false times out with the last result and attempt count', { timeout: 1000 }, async () => {
  let calls = 0;
  await assert.rejects(waitForAsync({ async evaluate() { calls++; return false; } }, async () => false, null,
    { timeout: 25, interval: 1, label: 'saved scan completion' }), error => {
    assert.equal(error.name, 'TimeoutError'); assert.equal(error.lastResult, false);
    assert.equal(error.attempts, calls); assert.ok(calls >= 2);
    assert.match(error.message, /saved scan completion.*last result=false/); return true;
  });
});

test('overall deadline bounds a stuck evaluate and never starts another evaluation', { timeout: 1000 }, async () => {
  const stalled = deferred(); let calls = 0;
  await assert.rejects(waitForAsync({ evaluate() { calls++; return stalled.promise; } }, async () => true, null,
    { timeout: 20, interval: 1 }), { name: 'TimeoutError', attempts: 1 });
  stalled.resolve(false); await nextTurn(); await nextTurn();
  assert.equal(calls, 1, 'late completion must not resume polling after timeout');
});

test('deadline also bounds a long polling interval', { timeout: 1000 }, async () => {
  let calls = 0;
  await assert.rejects(waitForAsync({ async evaluate() { calls++; return 0; } }, async () => 0, null,
    { timeout: 20, interval: 60_000 }), { name: 'TimeoutError', lastResult: 0 });
  assert.equal(calls, 1);
});

test('predicate failure retains its original cause and the previous false result', async () => {
  const failure = new Error('IndexedDB transaction failed'); let calls = 0;
  const page = { async evaluate() { if (++calls === 1) return false; throw failure; } };
  await assert.rejects(waitForAsync(page, async () => false, undefined, { timeout: 100, interval: 1 }), error => {
    assert.equal(error.cause, failure); assert.equal(error.lastError, failure); assert.equal(error.lastResult, false);
    assert.equal(error.attempts, 2); assert.match(error.message, /IndexedDB transaction failed/); return true;
  });
});

test('late evaluation rejection after timeout remains handled', { timeout: 1000 }, async () => {
  const stalled = deferred();
  await assert.rejects(waitForAsync({ evaluate() { return stalled.promise; } }, async () => true, null,
    { timeout: 15 }), { name: 'TimeoutError' });
  stalled.reject(new Error('late remote failure')); await nextTurn();
});

test('invalid or unbounded options are rejected before evaluation', async () => {
  let calls = 0; const page = { evaluate() { calls++; } };
  for (const options of [{ timeout: Infinity }, { timeout: 0 }, { timeout: NaN }, { interval: Infinity }, { interval: 0 }]) {
    await assert.rejects(waitForAsync(page, async () => true, undefined, options), RangeError);
  }
  assert.equal(calls, 0);
});
