import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the actual main.js helper without booting its browser-only application.
// Browser coverage remains in focus-navigation.browser.mjs: these tests verify
// settlement ownership, not layout, keyboard dispatch, or WAAPI behavior itself.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('async function settlePageTurnForLayout()');
const end = source.indexOf('\nfunction navigate(number)', start);
assert.ok(start >= 0 && end > start, 'main.js exposes the layout settlement helper');
const helper = source.slice(start, end);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function setup() {
  const context = vm.createContext({
    turnController: null,
    turnCompletion: Promise.resolve(),
    finishTurnsForLayout: false,
    $: () => ({ querySelector: () => null }),
  });
  vm.runInContext(helper, context);
  return context;
}

test('layout settlement is a no-op without an active turn', async () => {
  const state = setup();
  state.$ = () => { throw Error('idle settlement must not inspect an animation'); };
  await state.settlePageTurnForLayout();
  assert.equal(state.finishTurnsForLayout, false);
});

test('layout settlement finishes the active animation and restores the flag', async () => {
  const state = setup(), completion = deferred();
  state.turnController = {};
  state.turnCompletion = completion.promise;
  let finishes = 0;
  state.$ = () => ({ querySelector: () => ({ getAnimations: () => [{ finish() {
    finishes++;
    assert.equal(state.finishTurnsForLayout, true);
    state.turnController = null;
    completion.resolve();
  } }] }) });
  await state.settlePageTurnForLayout();
  assert.equal(finishes, 1);
  assert.equal(state.finishTurnsForLayout, false);
});

test('layout settlement waits for preparation before allowing a layout change', async () => {
  const state = setup(), completion = deferred();
  state.turnController = {};
  state.turnCompletion = completion.promise;
  let settled = false;
  const pending = state.settlePageTurnForLayout().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(state.finishTurnsForLayout, true);
  state.turnController = null;
  completion.resolve();
  await pending;
  assert.equal(settled, true);
  assert.equal(state.finishTurnsForLayout, false);
});

test('layout settlement drains a queued turn before restoring normal animation', async () => {
  const state = setup(), first = deferred(), second = deferred();
  state.turnController = {};
  state.turnCompletion = first.promise;
  let settled = false;
  const pending = state.settlePageTurnForLayout().then(() => { settled = true; });
  // flipTo starts its queued direction synchronously before resolving the old
  // completion. Match that ordering, regardless of forward/reverse direction.
  state.turnController = {};
  state.turnCompletion = second.promise;
  first.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(state.finishTurnsForLayout, true);
  state.turnController = null;
  second.resolve();
  await pending;
  assert.equal(settled, true);
  assert.equal(state.finishTurnsForLayout, false);
});

test('a concurrently cancelled animation can reject finish without losing settlement', async () => {
  const state = setup(), completion = deferred();
  state.turnController = {};
  state.turnCompletion = completion.promise;
  state.$ = () => ({ querySelector: () => ({ getAnimations: () => [{ finish() {
    throw Error('Animation is already cancelled');
  } }] }) });
  const pending = state.settlePageTurnForLayout();
  assert.equal(state.finishTurnsForLayout, true);
  state.turnController = null;
  completion.resolve();
  await pending;
  assert.equal(state.finishTurnsForLayout, false);
});
