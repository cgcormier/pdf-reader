import test from 'node:test';
import assert from 'node:assert/strict';
import { attachContentsDrag } from '../src/contents-drag.js';
function fixture() {
  class Element extends EventTarget {
    constructor() { super(); this.children = []; this.attrs = {}; this.classList = { add() {}, remove() {} }; this.style = { setProperty: (_, v) => { this.offset = parseFloat(v); }, removeProperty: () => { this.offset = 0; } }; this.offset = 0; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(k, v) { this.attrs[k] = v; }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; }
    focus() {} remove() { this.removed = true; }
  }
  const heading = new Element(), panel = new Element();
  panel.querySelector = () => heading;
  let width = 1000, hidden = false, drawerX = 0;
  panel.getBoundingClientRect = () => ({ left: 10 + panel.offset + drawerX, width: 300 });
  const win = new EventTarget();
  let observe;
  win.getComputedStyle = () => ({ display: hidden ? 'none' : 'flex', visibility: 'visible', transform: drawerX ? `matrix(1,0,0,1,${drawerX},0)` : 'none' });
  win.DOMMatrixReadOnly = class { constructor() { this.m41 = drawerX; } };
  win.MutationObserver = class { constructor(fn) { observe = fn; } observe() {} disconnect() {} };
  const doc = { getElementById: () => panel, createElement: () => new Element(), body: {}, documentElement: { get clientWidth() { return width; } } };
  const api = attachContentsDrag({ document: doc, window: win });
  const handle = heading.children[0];
  function event(type, detail = {}) { const e = new Event(type, { cancelable: true }); Object.assign(e, detail); handle.dispatchEvent(e); return e; }
  return { panel, handle, api, event, resize: n => { width = n; win.dispatchEvent(new Event('resize')); }, visibility: v => { hidden = !v; observe(); }, transform: x => { drawerX = x; observe(); } };
}
test('keyboard moves and clamps, Home resets; modifiers untouched', () => {
  const f = fixture();
  assert.equal(f.event('keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  assert.equal(f.panel.offset, 20);
  f.event('keydown', { key: 'ArrowRight', ctrlKey: true }); assert.equal(f.panel.offset, 20);
  for (let i = 0; i < 60; i++) f.event('keydown', { key: 'ArrowRight' });
  assert.equal(f.panel.offset, 690);
  f.event('keydown', { key: 'Home' }); assert.equal(f.panel.offset, 0);
  f.event('keydown', { key: 'ArrowLeft' }); assert.equal(f.panel.offset, -10);
});
test('pointer capture, independent pointers, cancel and resize', () => {
  const f = fixture();
  f.event('pointerdown', { button: 0, pointerId: 1, clientX: 50 });
  f.event('pointermove', { pointerId: 2, clientX: 800 }); assert.equal(f.panel.offset, 0);
  f.event('pointermove', { pointerId: 1, clientX: 450 }); assert.equal(f.panel.offset, 400);
  f.event('pointercancel', { pointerId: 1 }); assert.equal(f.handle.capture, null);
  f.event('pointermove', { pointerId: 1, clientX: 600 }); assert.equal(f.panel.offset, 400);
  f.resize(350); assert.equal(f.panel.offset, 40);
});
test('hidden geometry preserves offset; visible state reclamps; drawer transform independent', () => {
  const f = fixture(); f.event('keydown', { key: 'ArrowRight' });
  f.visibility(false); f.resize(310); assert.equal(f.panel.offset, 20);
  f.visibility(true); assert.equal(f.panel.offset, 0);
  f.resize(1000); f.transform(-200); f.event('keydown', { key: 'ArrowRight' });
  assert.equal(f.panel.offset, 20);
  f.api.destroy(); assert.equal(f.panel.offset, 0); assert.equal(f.handle.removed, true);
});
