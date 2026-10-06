const READING_INSET = 16;

/** A Fenwick tree backed page-height index for O(log n) geometry updates. */
export function createPageGeometry({ count, estimateHeight = 700, gap = 28 } = {}) {
  const rawCount = Number(count);
  const pageCount = Number.isFinite(rawCount) ? Math.max(0, Math.trunc(rawCount)) : 0;
  const rawHeight = Number(estimateHeight);
  const defaultHeight = Math.max(1, Number.isFinite(rawHeight) && rawHeight ? rawHeight : 700);
  const rawGap = Number(gap);
  const pageGap = Math.max(0, Number.isFinite(rawGap) ? rawGap : 0);
  const heights = new Float64Array(pageCount + 1);
  const tree = new Float64Array(pageCount + 1);
  heights.fill(defaultHeight);
  const defaultBlockHeight = defaultHeight + pageGap;
  for (let page = 1; page <= pageCount; page += 1) tree[page] = defaultBlockHeight;
  for (let page = 1; page <= pageCount; page += 1) {
    const parent = page + (page & -page);
    if (parent <= pageCount) tree[parent] += tree[page];
  }

  const updateTree = (page, delta) => {
    for (let index = page; index <= pageCount; index += index & -index) tree[index] += delta;
  };

  const prefixBlocks = (numberOfPages) => {
    let total = 0;
    for (let index = Math.min(pageCount, Math.max(0, numberOfPages)); index > 0; index -= index & -index) total += tree[index];
    return total;
  };

  const getHeight = (page) => page >= 1 && page <= pageCount ? heights[page] : 0;
  const setHeight = (page, rawHeight) => {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) return 0;
    const numericHeight = Number(rawHeight);
    const next = Math.max(1, Number.isFinite(numericHeight) && numericHeight ? numericHeight : defaultHeight);
    const delta = next - heights[page];
    if (Math.abs(delta) < 0.25) return 0;
    heights[page] = next;
    updateTree(page, delta);
    return delta;
  };

  const pageAt = (rawOffset) => {
    if (!pageCount) return 0;
    // CSS scroll offsets are quantized; a tiny rounding error at a page start
    // must not turn that anchor into the previous page's clamped end fraction.
    const offset = Math.max(0, Number(rawOffset) || 0) + 0.5;
    let index = 0;
    let accumulated = 0;
    let step = 1;
    while ((step << 1) <= pageCount) step <<= 1;
    for (; step; step >>= 1) {
      const next = index + step;
      if (next <= pageCount && accumulated + tree[next] <= offset) {
        index = next;
        accumulated += tree[next];
      }
    }
    return Math.min(pageCount, index + 1);
  };

  const pageStart = (page) => prefixBlocks(Math.min(pageCount, Math.max(0, Math.trunc(page) - 1)));
  const totalHeight = () => prefixBlocks(pageCount);
  const positionAt = (rawOffset) => {
    const page = pageAt(rawOffset);
    if (!page) return { page: 1, fraction: 0 };
    return {
      page,
      fraction: Math.max(0, Math.min(1, (Math.max(0, Number(rawOffset) || 0) - pageStart(page)) / getHeight(page))),
    };
  };
  const offsetForPosition = (page, fraction = 0, inset = READING_INSET) => {
    if (!pageCount) return 0;
    const safePage = Math.max(1, Math.min(pageCount, Math.trunc(Number(page) || 1)));
    const safeFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
    const rawInset = Number(inset);
    const safeInset = Number.isFinite(rawInset) ? rawInset : 0;
    return Math.max(0, pageStart(safePage) + getHeight(safePage) * safeFraction - safeInset);
  };

  return { count: pageCount, gap: pageGap, getHeight, setHeight, pageStart, totalHeight, pageAt, positionAt, offsetForPosition };
}

/** Bound the mounted window while favoring visible pages and the reading page. */
export function computePageWindow({ count, currentPage, firstVisible, lastVisible, overscan = 2, maxMounted = 7 } = {}) {
  const pageCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (!pageCount) return { start: 0, end: -1 };
  const limit = Math.max(1, Math.trunc(Number(maxMounted) || 7));
  const pad = Math.max(0, Math.trunc(Number(overscan) || 0));
  const current = Math.max(1, Math.min(pageCount, Math.trunc(Number(currentPage) || 1)));
  const first = Math.max(1, Math.min(pageCount, Math.trunc(Number(firstVisible) || current)));
  const last = Math.max(first, Math.min(pageCount, Math.trunc(Number(lastVisible) || current)));
  if (pageCount <= limit) return { start: 1, end: pageCount };

  let start = Math.max(1, first - pad);
  let end = Math.min(pageCount, last + pad);
  if (end - start + 1 > limit) {
    start = Math.max(1, Math.min(pageCount - limit + 1, current - pad));
    end = start + limit - 1;
  }
  if (end - start + 1 < limit) start = Math.max(1, end - limit + 1);
  return { start, end };
}

function clampFraction(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function releaseCanvases(node) {
  for (const canvas of node?.querySelectorAll?.('canvas') ?? []) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function clampPage(value, count) {
  return Math.max(1, Math.min(count, Math.trunc(Number(value) || 1)));
}

/**
 * Keep a small native-scroll window of source pages mounted around the reader.
 * The caller owns page styling and supplies DOM creation and loading.
 */
export function createPageScroller(container, {
  count,
  initialPage = 1,
  initialFraction = 0,
  estimateHeight = 700,
  gap = 28,
  overscan = 2,
  maxMounted = 7,
  maxConcurrent = 2,
  createPage,
  loadPage,
  onPosition,
} = {}) {
  if (!container || !container.ownerDocument) throw new TypeError('A DOM container is required.');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer.');
  if (typeof createPage !== 'function') throw new TypeError('createPage must be a function.');

  const doc = container.ownerDocument;
  const view = doc.defaultView ?? globalThis;
  const geometry = createPageGeometry({ count, estimateHeight, gap });
  const mountedLimit = Math.max(1, Math.trunc(Number(maxMounted) || 7));
  const concurrentLimit = Math.max(1, Math.trunc(Number(maxConcurrent) || 2));
  const mounted = new Map();
  const queued = [];
  const active = new Set();
  const taskForPage = new Map();
  const originalOverflowAnchor = container.style.overflowAnchor;
  const originalOverflowY = container.style.overflowY;
  let destroyed = false;
  let frameId = null;
  let currentWindow = null;
  let lastNotified = null;

  function padding(name) {
    const value = Number.parseFloat(view.getComputedStyle?.(container)?.[name]);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function lineInset() {
    // scrollTop measures from the scrollport, while page geometry starts at
    // the track after the container's top padding.
    return READING_INSET - padding('paddingTop');
  }

  function documentYAtReadingLine() {
    return Math.max(0, container.scrollTop + lineInset());
  }

  const track = doc.createElement('div');
  track.className = 'scroll-track';
  const topSpacer = doc.createElement('div');
  topSpacer.className = 'scroll-spacer scroll-spacer-top';
  topSpacer.setAttribute('aria-hidden', 'true');
  const bottomSpacer = doc.createElement('div');
  bottomSpacer.className = 'scroll-spacer scroll-spacer-bottom';
  bottomSpacer.setAttribute('aria-hidden', 'true');
  topSpacer.style.flex = 'none';
  bottomSpacer.style.flex = 'none';
  track.append(topSpacer, bottomSpacer);
  container.append(track);
  container.style.overflowY = 'auto';
  container.style.overflowAnchor = 'none';

  let resizeObserver = null;
  if (typeof view.ResizeObserver === 'function') {
    resizeObserver = new view.ResizeObserver((entries) => {
      if (destroyed) return;
      const resizedContainer = entries.some(entry => entry.target === container);
      const anchor = resizedContainer && lastNotified ? lastNotified : geometry.positionAt(documentYAtReadingLine());
      const slots = new Set(entries.map((entry) => entry.target));
      let changed = false;
      for (const record of mounted.values()) {
        if (!slots.has(record.slot)) continue;
        const measured = record.slot.getBoundingClientRect?.().height
          || entries.find((entry) => entry.target === record.slot)?.contentRect?.height
          || 0;
        if (measured > 0 && geometry.setHeight(record.page, measured) !== 0) changed = true;
      }
      if (changed || resizedContainer) {
        syncSpacers();
        container.scrollTop = geometry.offsetForPosition(anchor.page, anchor.fraction, lineInset());
        scheduleFrame();
      }
    });
  }

  function stats() {
    const pages = [...mounted.keys()].sort((a, b) => a - b);
    container.dataset.mountedPages = String(pages.length);
    container.dataset.activeLoads = String(active.size);
    return { pages, mountedPages: pages.length, activeLoads: active.size, queuedLoads: queued.length };
  }

  function syncSpacers() {
    // Leave room below the final page so it can reach the reading line even
    // when the viewport is taller than that page. No extra page is invented.
    const tail = Math.max(0, container.clientHeight - READING_INSET - padding('paddingBottom') - geometry.getHeight(count) - geometry.gap);
    if (!mounted.size) {
      topSpacer.style.height = '0px';
      bottomSpacer.style.height = `${geometry.totalHeight() + tail}px`;
      return;
    }
    const pages = [...mounted.keys()].sort((a, b) => a - b);
    const first = pages[0];
    const last = pages.at(-1);
    const top = geometry.pageStart(first);
    const mountedBlocks = geometry.pageStart(last) + geometry.getHeight(last) + gap - top;
    topSpacer.style.height = `${Math.max(0, top)}px`;
    bottomSpacer.style.height = `${Math.max(0, geometry.totalHeight() - top - mountedBlocks) + tail}px`;
  }

  function insertSlot(page, slot) {
    let before = bottomSpacer;
    for (let nextPage = page + 1; nextPage <= (currentWindow?.end ?? count); nextPage += 1) {
      const next = mounted.get(nextPage);
      if (next) {
        before = next.slot;
        break;
      }
    }
    track.insertBefore(slot, before);
  }

  function pumpLoads() {
    if (destroyed) return;
    while (active.size < concurrentLimit && queued.length) {
      const task = queued.shift();
      if (task.cancelled || mounted.get(task.page) !== task.record) continue;
      task.started = true;
      active.add(task);
      stats();
      let result;
      try {
        result = loadPage?.(task.page, task.record.node, { signal: task.controller.signal });
      } catch (error) {
        result = Promise.reject(error);
      }
      Promise.resolve(result).catch(() => {}).finally(() => {
        active.delete(task);
        if (taskForPage.get(task.page) === task) taskForPage.delete(task.page);
        if (mounted.get(task.page) !== task.record || destroyed) releaseCanvases(task.record.node);
        if (!destroyed) {
          stats();
          pumpLoads();
          scheduleFrame();
        }
      });
    }
    stats();
  }

  function unmountPage(page) {
    const record = mounted.get(page);
    if (!record) return;
    mounted.delete(page);
    const task = taskForPage.get(page);
    if (task && task.record === record) {
      task.cancelled = true;
      task.controller.abort();
      if (!task.started) {
        const index = queued.indexOf(task);
        if (index >= 0) queued.splice(index, 1);
        taskForPage.delete(page);
      } else if (taskForPage.get(page) === task) {
        taskForPage.delete(page);
      }
    }
    resizeObserver?.unobserve(record.slot);
    record.slot.remove();
    releaseCanvases(record.node);
  }

  function mountPage(page) {
    const node = createPage(page);
    if (!node || typeof node !== 'object') throw new TypeError(`createPage(${page}) must return a DOM element.`);
    const slot = doc.createElement('div');
    slot.className = 'scroll-page-slot';
    slot.style.marginBottom = `${gap}px`;
    slot.append(node);
    const record = { page, node, slot };
    mounted.set(page, record);
    insertSlot(page, slot);
    resizeObserver?.observe(slot);
    if (typeof loadPage === 'function') {
      const task = { page, record, controller: new AbortController(), started: false, cancelled: false };
      taskForPage.set(page, task);
      queued.push(task);
    }
  }

  function viewportRange() {
    const top = documentYAtReadingLine();
    const clientHeight = Math.max(1, container.clientHeight || estimateHeight);
    const bottom = Math.max(top, container.scrollTop + clientHeight - padding('paddingTop') - padding('paddingBottom'));
    const first = geometry.pageAt(top);
    const last = geometry.pageAt(bottom);
    return { top, bottom, first: first || 1, last: last || 1 };
  }

  function updateWindow() {
    const range = viewportRange();
    const position = geometry.positionAt(range.top);
    const desired = computePageWindow({
      count,
      currentPage: position.page,
      firstVisible: range.first,
      lastVisible: range.last,
      overscan,
      maxMounted: mountedLimit,
    });
    if (!currentWindow || desired.start !== currentWindow.start || desired.end !== currentWindow.end) {
      currentWindow = desired;
      for (const page of [...mounted.keys()]) {
        if (page < desired.start || page > desired.end) unmountPage(page);
      }
      for (let page = desired.start; page <= desired.end; page += 1) {
        if (!mounted.has(page)) mountPage(page);
      }
      queued.sort((a, b) => Math.abs(a.page - position.page) - Math.abs(b.page - position.page));
      pumpLoads();
    }
    syncSpacers();
    stats();
    notifyPosition(position);
  }

  function notifyPosition(position = geometry.positionAt(documentYAtReadingLine())) {
    if (destroyed) return;
    const fraction = clampFraction(position.fraction);
    if (lastNotified && lastNotified.page === position.page && Math.abs(lastNotified.fraction - fraction) < 0.001) return;
    lastNotified = { page: position.page, fraction };
    onPosition?.({ ...lastNotified });
  }

  function scheduleFrame() {
    if (destroyed || frameId != null) return;
    const request = view.requestAnimationFrame ?? ((callback) => view.setTimeout(callback, 0));
    frameId = request.call(view, () => {
      frameId = null;
      if (!destroyed) updateWindow();
    });
  }

  function handleScroll() {
    scheduleFrame();
  }

  function jumpTo(page, { fraction = 0, behavior = 'auto' } = {}) {
    if (destroyed) return;
    const targetPage = clampPage(page, count);
    const safeFraction = clampFraction(fraction);
    const current = geometry.positionAt(documentYAtReadingLine());
    let nextBehavior = behavior === 'smooth' && Math.abs(targetPage - current.page) <= 3 ? 'smooth' : 'auto';
    if (nextBehavior === 'smooth' && view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) nextBehavior = 'auto';
    const top = geometry.offsetForPosition(targetPage, safeFraction, lineInset());
    if (typeof container.scrollTo === 'function') container.scrollTo({ top, behavior: nextBehavior });
    else container.scrollTop = top;
    scheduleFrame();
  }

  function getPosition() {
    return geometry.positionAt(documentYAtReadingLine());
  }

  function reflow() {
    if (destroyed) return;
    const position = getPosition();
    for (const record of mounted.values()) {
      const measured = record.slot.getBoundingClientRect?.().height ?? 0;
      if (measured > 0) geometry.setHeight(record.page, measured);
    }
    syncSpacers();
    container.scrollTop = geometry.offsetForPosition(position.page, position.fraction, lineInset());
    scheduleFrame();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    container.removeEventListener('scroll', handleScroll);
    if (frameId != null) {
      const cancel = view.cancelAnimationFrame ?? view.clearTimeout;
      cancel?.call(view, frameId);
      frameId = null;
    }
    resizeObserver?.disconnect();
    for (const task of taskForPage.values()) {
      task.cancelled = true;
      task.controller.abort();
    }
    queued.length = 0;
    for (const record of mounted.values()) {
      record.slot.remove();
      releaseCanvases(record.node);
    }
    mounted.clear();
    track.remove();
    container.style.overflowAnchor = originalOverflowAnchor;
    container.style.overflowY = originalOverflowY;
    container.dataset.mountedPages = '0';
    container.dataset.activeLoads = String(active.size);
  }

  container.addEventListener('scroll', handleScroll, { passive: true });
  // A real browser clamps scrollTop to the existing scroll height. Establish
  // the estimated document height before assigning a restored nonzero place.
  syncSpacers();
  container.scrollTop = geometry.offsetForPosition(clampPage(initialPage, count), initialFraction, lineInset());
  updateWindow();
  resizeObserver?.observe(container);
  pumpLoads();

  return { jumpTo, getPosition, reflow, destroy, getStats: stats };
}
