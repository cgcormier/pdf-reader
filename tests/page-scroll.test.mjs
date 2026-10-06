import test from 'node:test';
import assert from 'node:assert/strict';
import { computePageWindow, createPageGeometry, createPageScroller } from '../src/page-scroll.js';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.style = { overflowAnchor: '', overflowY: '' };
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.parentNode = null;
    this.scrollTop = 0;
    this.clientHeight = 100;
    this.measuredHeight = null;
  }

  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) {
    node.remove();
    this.children.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node, before) {
    node.remove();
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
    return node;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ type, target: this }); }
  scrollTo({ top }) { this.scrollTop = top; }
  getBoundingClientRect() {
    const childHeight = this.children[0]?.getBoundingClientRect?.().height ?? 0;
    const rawHeight = this.measuredHeight ?? Number.parseFloat(this.style.height) ?? childHeight;
    return { height: rawHeight || childHeight || 0 };
  }
  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selector === 'canvas' && child.tagName === 'CANVAS') matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

class FakeResizeObserver {
  constructor(callback) { this.callback = callback; this.targets = new Set(); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  emit(target, height) {
    target.measuredHeight = height;
    this.callback([{ target, contentRect: { height } }]);
  }
}

function fakeContainer({ clientHeight = 100, clampScroll = false } = {}) {
  let nextFrame = 1;
  const frames = new Map();
  const view = {
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => ({ matches: false }),
  };
  view.ResizeObserver = class extends FakeResizeObserver {
    constructor(callback) { super(callback); view.lastObserver = this; }
  };
  const doc = { defaultView: view, createElement: (tag) => new FakeElement(tag, doc) };
  const container = new FakeElement('div', doc);
  container.clientHeight = clientHeight;
  if (clampScroll) {
    let top = 0;
    function contentHeight(node) {
      const explicit = Number.parseFloat(node.style.height);
      return Number.isFinite(explicit) ? explicit : node.children.reduce((sum, child) => sum + contentHeight(child) + (Number.parseFloat(child.style.marginBottom) || 0), 0);
    }
    Object.defineProperty(container, 'scrollTop', {
      get: () => top,
      set: value => { top = Math.max(0, Math.min(value, Math.max(0, contentHeight(container) - container.clientHeight))); },
    });
  }
  const flushFrames = () => {
    while (frames.size) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
  };
  return { container, view, frames, flushFrames };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('page geometry maps gaps, variable heights, and page fractions', () => {
  const geometry = createPageGeometry({ count: 3, estimateHeight: 100, gap: 10 });
  assert.equal(geometry.totalHeight(), 330);
  assert.equal(geometry.pageAt(109), 1);
  assert.equal(geometry.pageAt(110), 2);
  geometry.setHeight(1, 150);
  assert.equal(geometry.pageStart(3), 270);
  const top = geometry.offsetForPosition(2, 0.5, 16);
  assert.deepEqual(geometry.positionAt(top + 16), { page: 2, fraction: 0.5 });
  geometry.setHeight(1, 150.7);
  const start = geometry.pageStart(2);
  assert.deepEqual(geometry.positionAt(start - 0.04), { page: 2, fraction: 0 }, 'CSS subpixel rounding retains a page-start anchor');
});

test('page window remains bounded at the document edges and on large visible ranges', () => {
  assert.deepEqual(computePageWindow({ count: 100, currentPage: 1, firstVisible: 1, lastVisible: 2, overscan: 2, maxMounted: 7 }), { start: 1, end: 4 });
  const window = computePageWindow({ count: 100, currentPage: 50, firstVisible: 20, lastVisible: 40, overscan: 2, maxMounted: 7 });
  assert.ok(window.start <= 50 && window.end >= 50);
  assert.ok(window.end - window.start + 1 <= 7);
});

test('scroller bounds mounted pages and active loads, aborts departed jobs, and cleans up', async () => {
  const { container, flushFrames } = fakeContainer({ clientHeight: 100 });
  const jobs = [];
  let peakActive = 0;
  const positions = [];
  const scroller = createPageScroller(container, {
    count: 1000,
    estimateHeight: 100,
    gap: 10,
    maxMounted: 7,
    maxConcurrent: 2,
    overscan: 2,
    createPage(page) {
      const article = new FakeElement('article', container.ownerDocument);
      article.style.height = '100px';
      article.page = page;
      const canvas = new FakeElement('canvas', container.ownerDocument);
      canvas.width = 100;
      canvas.height = 200;
      article.append(canvas);
      return article;
    },
    loadPage(page, node, { signal }) {
      const job = { page, signal, node, ...deferred() };
      jobs.push(job);
      peakActive = Math.max(peakActive, jobs.filter((candidate) => !candidate.finished).length);
      job.promise.then(() => { job.finished = true; }, () => { job.finished = true; });
      return job.promise;
    },
    onPosition: (position) => positions.push(position),
  });

  assert.ok(scroller.getStats().mountedPages <= 7);
  assert.equal(scroller.getStats().activeLoads, 2);
  assert.equal(container.dataset.mountedPages, '3');
  assert.equal(container.dataset.activeLoads, '2');
  assert.equal(peakActive, 2);
  const firstJobs = [...jobs];

  scroller.jumpTo(500);
  flushFrames();
  assert.equal(scroller.getPosition().page, 500);
  assert.ok(scroller.getStats().pages.includes(500));
  assert.ok(scroller.getStats().mountedPages <= 7);
  assert.deepEqual(firstJobs.map((job) => job.signal.aborted), [true, true]);
  assert.equal(jobs.length, 2, 'cancelled but unsettled loads still consume concurrency');

  for (const job of firstJobs) job.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(jobs.length > 2, 'the next window starts after old loaders settle');
  assert.ok(peakActive <= 2);
  const liveNodes = container.children[0].children.filter((child) => child.className === 'scroll-page-slot');
  const canvases = liveNodes.flatMap((slot) => slot.querySelectorAll('canvas'));
  assert.ok(canvases.length > 0);

  const notifyCount = positions.length;
  scroller.destroy();
  assert.equal(container.children.length, 0);
  assert.equal(container.dataset.mountedPages, '0');
  assert.equal(container.style.overflowAnchor, '');
  assert.equal(container.style.overflowY, '');
  assert.ok(jobs.slice(2).every((job) => job.signal.aborted));
  assert.ok(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  container.dispatch('scroll');
  flushFrames();
  assert.equal(positions.length, notifyCount, 'destroyed scrollers do not notify the caller');
});

test('ResizeObserver measurement above the reader preserves page and fraction', () => {
  const { container } = fakeContainer({ clientHeight: 100 });
  const scroller = createPageScroller(container, {
    count: 12,
    initialPage: 3,
    estimateHeight: 100,
    gap: 10,
    createPage() {
      const page = new FakeElement('article', container.ownerDocument);
      page.style.height = '100px';
      return page;
    },
  });
  const before = scroller.getPosition();
  const instance = [...container.children[0].children].length;
  assert.ok(instance > 2);
  const resizeObserver = container.ownerDocument.defaultView;
  // The test view exposes the active observer instances through the constructor hook.
  const target = container.children[0].children.find((node) => node.className === 'scroll-page-slot');
  const activeObserver = resizeObserver.lastObserver;
  assert.ok(target);
  assert.ok(activeObserver);
  activeObserver.emit(target, 150);
  assert.deepEqual(scroller.getPosition(), before);
  target.measuredHeight = null;
  target.children[0].style.height = '160px';
  scroller.reflow();
  assert.deepEqual(scroller.getPosition(), before);
  scroller.destroy();
});

test('a browser-clamped scroll container restores distant pages and can anchor its final short page', () => {
  const { container, flushFrames } = fakeContainer({ clientHeight: 500, clampScroll: true });
  const positions = [];
  const scroller = createPageScroller(container, {
    count: 100, initialPage: 93, initialFraction: 0.25, estimateHeight: 100, gap: 10,
    createPage() { const page = new FakeElement('article', container.ownerDocument); page.style.height = '100px'; return page; },
    onPosition: position => positions.push(position),
  });
  assert.deepEqual(scroller.getPosition(), { page: 93, fraction: 0.25 });
  assert.deepEqual(positions[0], { page: 93, fraction: 0.25 });
  scroller.jumpTo(100);
  flushFrames();
  assert.equal(scroller.getPosition().page, 100);
  assert.equal(positions.at(-1).page, 100);
  scroller.destroy();
});
