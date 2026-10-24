import test from 'node:test';
import assert from 'node:assert/strict';
import { turnPages } from '../src/page-turn.js';

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  tokens() { return this.owner.className.split(/\s+/).filter(Boolean); }
  add(token) { if (!this.contains(token)) this.owner.className = [...this.tokens(), token].join(' '); }
  remove(token) { this.owner.className = this.tokens().filter(value => value !== token).join(' '); }
  contains(token) { return this.tokens().includes(token); }
}

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = {};
    this._scrollTop = 0;
    this.connected = false;
    this.inert = false;
  }
  get isConnected() { return this.connected || Boolean(this.parentNode?.isConnected); }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(value) { this._scrollTop = this.isConnected ? value : 0; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) {
    node.remove();
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  replaceChild(node, old) {
    node.remove();
    this.children[this.children.indexOf(old)] = node;
    old.parentNode = null;
    node.parentNode = this;
    return old;
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const result = [];
    const matches = node => selector === '*' || (selector === '[id]' && node.getAttribute('id') !== null) || (selector.startsWith('.') && node.classList.contains(selector.slice(1)));
    const visit = node => { for (const child of node.children) { if (matches(child)) result.push(child); visit(child); } };
    visit(this);
    return result;
  }
  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, this.ownerDocument);
    clone.className = this.className;
    clone.attributes = { ...this.attributes };
    clone.inert = this.inert;
    if (deep) for (const child of this.children) clone.append(child.cloneNode(true));
    return clone;
  }
}

function fixture({ animate = true } = {}) {
  const animations = [];
  const doc = { createElement: tag => new FakeElement(tag, doc) };
  const stage = new FakeElement('div', doc);
  stage.connected = true;
  const page = (name, scrollTop = 0) => {
    const paper = doc.createElement('article');
    paper.className = `paper-page ${name}`;
    paper.setAttribute('id', `id-${name}`);
    const prose = doc.createElement('div');
    prose.className = 'page-prose';
    prose.scrollTop = scrollTop;
    paper.append(prose);
    return paper;
  };
  const currentLeft = page('left', 15);
  const currentRight = page('right', 27);
  const nextLeft = page('next-left', 38);
  const nextRight = page('next-right', 49);
  stage.append(currentLeft, currentRight);
  currentLeft.querySelector('.page-prose').scrollTop = 15;
  currentRight.querySelector('.page-prose').scrollTop = 27;
  if (animate) FakeElement.prototype.animate = function (keyframes, options) {
    let resolve;
    let reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const record = { node: this, keyframes, options, finished, resolve, reject, cancel() { reject(new Error('cancelled')); } };
    animations.push(record);
    return record;
  };
  return { doc, stage, currentLeft, currentRight, nextLeft, nextRight, animations };
}

function findClass(node, className) { return node.querySelector(`.${className}`); }

test('forward desktop turn hinges from the left with current-right front and next-left back', async () => {
  const f = fixture();
  const pending = turnPages({ stage: f.stage, targetPages: [f.nextLeft, f.nextRight], direction: 'forward', singlePage: false });
  const layer = f.stage.children.at(-1);
  assert.ok(layer.classList.contains('page-turn-layer'));
  assert.ok(layer.classList.contains('turn-forward'));
  assert.equal(layer.children[0].className, 'paper-page next-right page-turn-reveal');
  assert.equal(findClass(layer, 'page-turn-front').children[0].className, 'paper-page right page-turn-page');
  assert.equal(findClass(layer, 'page-turn-back').children[0].className, 'paper-page next-left page-turn-page');
  assert.ok(f.stage.children[1].classList.contains('turn-origin'));
  assert.deepEqual(f.animations[0].keyframes, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }]);
  const movingProse = findClass(findClass(layer, 'page-turn-front'), 'page-prose');
  assert.equal(movingProse.scrollTop, 27);
  assert.equal(findClass(layer, 'page-turn-front').children[0], f.currentRight);
  assert.equal(findClass(layer, 'page-turn-back').children[0], f.nextLeft);
  assert.equal(findClass(layer, 'page-turn-front').children[0].getAttribute('id'), 'id-right');
  assert.equal(layer.inert, true);
  f.animations[0].resolve();
  assert.equal(await pending, 'finished');
  assert.deepEqual(f.stage.children, [f.currentLeft, f.currentRight]);
  assert.equal(f.currentRight.classList.contains('turn-origin'), false);
  assert.equal(f.stage.classList.contains('is-turning'), false);
  assert.equal(f.nextLeft.parentNode, null);
  assert.equal(f.nextRight.parentNode, null);
  assert.equal(f.currentRight.querySelector('.page-prose').scrollTop, 27);
});

test('reverse desktop turn mirrors the hinge and reveals the destination left page', async () => {
  const f = fixture();
  const pending = turnPages({ stage: f.stage, targetPages: [f.nextLeft, f.nextRight], direction: 'backward', singlePage: false });
  const layer = f.stage.children.at(-1);
  assert.ok(layer.classList.contains('turn-backward'));
  assert.equal(layer.children[0].className, 'paper-page next-left page-turn-reveal');
  assert.equal(findClass(layer, 'page-turn-front').children[0].className, 'paper-page left page-turn-page');
  assert.equal(findClass(layer, 'page-turn-back').children[0].className, 'paper-page next-right page-turn-page');
  assert.ok(f.stage.children[0].classList.contains('turn-origin'));
  assert.deepEqual(f.animations[0].keyframes, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }]);
  f.animations[0].resolve();
  assert.equal(await pending, 'finished');
});

test('single-page turn uses a centered card and cleans up on abort without committing pages', async () => {
  const f = fixture();
  const onePageStage = new FakeElement('div', f.doc);
  onePageStage.connected = true;
  onePageStage.append(f.currentLeft);
  const controller = new AbortController();
  const pending = turnPages({ stage: onePageStage, targetPages: [f.nextLeft], direction: 'forward', singlePage: true, signal: controller.signal });
  const layer = onePageStage.children.at(-1);
  assert.ok(layer.classList.contains('turn-single'));
  assert.equal(layer.children.length, 1, 'single page has a card, with no spread reveal');
  controller.abort();
  assert.equal(await pending, 'cancelled');
  assert.deepEqual(onePageStage.children, [f.currentLeft]);
  assert.equal(f.currentLeft.classList.contains('turn-origin'), false);
  assert.equal(onePageStage.classList.contains('is-turning'), false);
});

test('pre-aborted and reduced-motion turns create no overlay', async () => {
  const aborted = fixture();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await turnPages({ stage: aborted.stage, targetPages: [aborted.nextLeft, aborted.nextRight], direction: 'forward', signal: controller.signal }), 'cancelled');
  const reduced = fixture();
  assert.equal(await turnPages({ stage: reduced.stage, targetPages: [reduced.nextLeft, reduced.nextRight], direction: 'forward', reducedMotion: true }), 'finished');
  assert.equal(aborted.stage.children.length, 2);
  assert.equal(reduced.stage.children.length, 2);
});

test('WAAPI rejection removes overlay and restores source classes', async () => {
  const f = fixture();
  const pending = turnPages({ stage: f.stage, targetPages: [f.nextLeft, f.nextRight], direction: 'forward' });
  f.animations[0].reject(new Error('animation failed'));
  assert.equal(await pending, 'cancelled');
  assert.deepEqual(f.stage.children, [f.currentLeft, f.currentRight]);
  assert.equal(f.currentRight.classList.contains('turn-origin'), false);
  assert.equal(f.stage.classList.contains('is-turning'), false);
});

test('missing WAAPI support finishes immediately and removes the temporary overlay', async () => {
  const original = FakeElement.prototype.animate;
  delete FakeElement.prototype.animate;
  try {
    const f = fixture({ animate: false });
    assert.equal(await turnPages({ stage: f.stage, targetPages: [f.nextLeft, f.nextRight], direction: 'forward' }), 'finished');
    assert.deepEqual(f.stage.children, [f.currentLeft, f.currentRight]);
  } finally { if (original) FakeElement.prototype.animate = original; }
});
