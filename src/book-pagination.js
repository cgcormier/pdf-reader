function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

export const FIT_CACHE_LIMIT = 4096;

/** Drive the same fitting requests used by the reader's cooperative DOM fitter. */
export function runPaginationSteps(steps, fits, { signal } = {}) {
  if (typeof fits !== 'function') throw new TypeError('fits must be a function');
  const measured = new Map();
  let step = steps.next();
  while (!step.done) {
    throwIfAborted(signal);
    const fragment = step.value;
    const key = `${fragment.start}:${fragment.end}`;
    let result;
    if (measured.has(key)) result = measured.get(key);
    else {
      result = fits(fragment.text, fragment);
      throwIfAborted(signal);
      // A pathological source page can generate many balancing candidates. Keep
      // exact-range reuse local and bounded rather than retaining its entire search.
      if (measured.size >= FIT_CACHE_LIMIT) measured.delete(measured.keys().next().value);
      measured.set(key, result);
    }
    throwIfAborted(signal);
    step = steps.next(result);
  }
  return step.value;
}

function safeBoundaryAtOrBefore(text, index) {
  if (index > 0 && index < text.length) {
    const current = text.charCodeAt(index);
    const previous = text.charCodeAt(index - 1);
    if (current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) return index - 1;
  }
  return index;
}

function nextCodePointBoundary(text, index) {
  const codePoint = text.codePointAt(index);
  return index + (codePoint > 0xffff ? 2 : 1);
}

function* largestFittingEnd(text, start, signal, hint) {
  let low = start + 1;
  let high = text.length;
  let best = start;

  const measure = function* (end) {
    throwIfAborted(signal);
    const result = yield { text: text.slice(start, end), start, end };
    throwIfAborted(signal);
    return result;
  };
  // Bound the work by the likely leaf size, rather than rendering half of all
  // remaining source text on the first probe. A hint is only a search bound;
  // every final break is still measured with this leaf's actual typography.
  let span = hint;
  let end = safeBoundaryAtOrBefore(text, Math.min(text.length, start + span));
  if (end <= start) end = nextCodePointBoundary(text, start);
  if (!(yield* measure(end))) high = end - 1;
  else {
    best = end;
    if (best === text.length) return best;
    const adjacent = nextCodePointBoundary(text, best);
    if (!(yield* measure(adjacent))) return best;
    best = adjacent;
    if (best === text.length) return best;
    while (best < text.length) {
      span = Math.max(span * 2, best - start + 1);
      end = safeBoundaryAtOrBefore(text, Math.min(text.length, start + span));
      if (end <= best) end = nextCodePointBoundary(text, best);
      if (!(yield* measure(end))) { low = best + 1; high = end - 1; break; }
      best = end;
      if (best === text.length) return best;
    }
  }

  while (low <= high) {
    throwIfAborted(signal);
    const middle = Math.floor((low + high) / 2);
    const end = safeBoundaryAtOrBefore(text, middle);
    if (end <= start) {
      low = middle + 1;
      continue;
    }

    if (yield* measure(end)) {
      best = end;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function lastWhitespaceEnd(text, start, end) {
  for (let index = end - 1; index >= start; index -= 1) {
    if (/\s/u.test(text[index])) return index + 1;
  }
  return start;
}

/** Split text into fitting, contiguous slices while preserving every source character. */
export function paginateText(text, fits, { signal } = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (typeof fits !== 'function') throw new TypeError('fits must be a function');
  return runPaginationSteps(paginateTextSteps(text, { signal }), fits, { signal });
}

/** Yield exact UTF-16 fit requests; callers may pause between DOM measurements. */
export function* paginateTextSteps(text, { signal } = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  throwIfAborted(signal);
  if (text.length === 0) return [{ start: 0, end: 0, text: '' }];

  const fragments = [];
  let start = 0;
  let hint = 512;
  while (start < text.length) {
    throwIfAborted(signal);
    const fittingEnd = yield* largestFittingEnd(text, start, signal, hint);
    hint = Math.max(1, fittingEnd - start);
    const whitespaceEnd = fittingEnd > start ? lastWhitespaceEnd(text, start, fittingEnd) : start;
    let end = fittingEnd === text.length
      ? text.length
      : whitespaceEnd > start ? whitespaceEnd : fittingEnd;

    if (end === start) {
      // An oversized word has no fitting whitespace boundary. Force one full
      // Unicode code point so even a too-tall glyph cannot stall pagination.
      end = nextCodePointBoundary(text, start);
    }

    fragments.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  return fragments;
}

/** Return the fragment containing a UTF-16 source offset, clamped to the last fragment. */
export function fragmentAt(fragments, offset) {
  if (!fragments.length) return -1;
  const target = Number.isFinite(offset) ? offset : 0;
  let low = 0;
  let high = fragments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const fragment = fragments[middle];
    if (target < fragment.start) high = middle - 1;
    else if (target >= fragment.end && middle < fragments.length - 1) low = middle + 1;
    else return middle;
  }
  return Math.max(0, Math.min(fragments.length - 1, low));
}

/** Navigate a book whose source pages each expand into one or more text fragments. */
export function createBookPager({ count, loadFragments }) {
  if (!Number.isInteger(count) || count < 0) throw new TypeError('count must be a nonnegative integer');
  if (typeof loadFragments !== 'function') throw new TypeError('loadFragments must be a function');

  const pageNumber = value => Math.max(1, Math.min(count || 1, Number.isFinite(value) ? Math.floor(value) : 1));
  const sourceOffset = value => Number.isFinite(value) ? Math.max(0, value) : 0;

  function pageReader() {
    const loaded = new Map();
    return async page => {
      if (!loaded.has(page)) loaded.set(page, await loadFragments(page));
      return loaded.get(page);
    };
  }

  async function seekForward(read, page, index = 0) {
    for (let currentPage = page; currentPage <= count; currentPage += 1) {
      const fragments = await read(currentPage);
      if (index >= 0 && index < fragments.length) return { page: currentPage, index, fragment: fragments[index] };
      index = 0;
    }
    return null;
  }

  async function seekBackward(read, page, index) {
    for (let currentPage = page; currentPage >= 1; currentPage -= 1) {
      const fragments = await read(currentPage);
      const candidate = currentPage === page ? Math.min(index, fragments.length - 1) : fragments.length - 1;
      if (candidate >= 0) return { page: currentPage, index: candidate, fragment: fragments[candidate] };
    }
    return null;
  }

  return {
    async spread(anchor = { page: 1, offset: 0 }, size = 1) {
      const read = pageReader();
      const requestedPage = pageNumber(anchor?.page);
      if (count === 0) return { anchor: { page: 1, offset: 0 }, leaves: [], next: null };

      let located = await seekForward(read, requestedPage, 0);
      const requestedFragments = await read(requestedPage);
      if (located && requestedFragments.length) {
        const fragments = requestedFragments;
        const index = fragmentAt(fragments, sourceOffset(anchor?.offset));
        located = await seekForward(read, requestedPage, index);
      }

      const first = located;
      const leaves = [];
      const limit = Math.max(1, Number.isFinite(size) ? Math.floor(size) : 1);
      while (located && leaves.length < limit) {
        leaves.push({ ...located.fragment, page: located.page });
        located = await seekForward(read, located.page, located.index + 1);
      }

      const normalizedAnchor = first
        ? { page: first.page, offset: first.fragment.start }
        : { page: requestedPage, offset: 0 };
      const next = located ? { page: located.page, offset: located.fragment.start } : null;
      return { anchor: normalizedAnchor, leaves, next };
    },

    async previous(anchor = { page: 1, offset: 0 }, steps = 1) {
      const read = pageReader();
      const requestedPage = pageNumber(anchor?.page);
      if (count === 0) return { page: 1, offset: 0 };
      const fragments = await read(requestedPage);
      const currentIndex = fragmentAt(fragments, sourceOffset(anchor?.offset));
      let located = currentIndex >= 0
        ? { page: requestedPage, index: currentIndex, fragment: fragments[currentIndex] }
        : await seekForward(read, requestedPage + 1, 0);

      const distance = Math.max(0, Number.isFinite(steps) ? Math.floor(steps) : 1);
      for (let step = 0; step < distance; step += 1) {
        if (!located) return { page: 1, offset: 0 };
        located = await seekBackward(read, located.page, located.index - 1);
      }
      return located
        ? { page: located.page, offset: located.fragment.start }
        : { page: 1, offset: 0 };
    },
  };
}
