/** Cache at most three prepared spreads, normally current/previous/next.
 * Pending loads are shared; failures/oversized DOM trees are not retained.
 * Displayed pages remain owned by the caller even when evicted from the cache.
 * The caller owns cancellation of prepare() through its layout signal.
 */
export function createSpreadBuffer({ prepare, maxEntries = 3, maxNodes = 1200 }) {
  if (typeof prepare !== 'function') throw new TypeError('prepare must be a function');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxNodes) || maxNodes < 1) throw new RangeError('buffer limits must be positive integers');
  const entries = new Map();
  let nodes = 0;
  const keyFor = anchor => `${anchor.page}:${anchor.offset}`;
  const remove = key => {
    const entry = entries.get(key);
    if (entry) nodes -= entry.nodes;
    entries.delete(key);
  };
  const trim = () => {
    while (entries.size > maxEntries || nodes > maxNodes) remove(entries.keys().next().value);
  };
  const store = (key, entry) => {
    remove(key);
    if (entry.nodes > maxNodes) return;
    entries.set(key, entry); nodes += entry.nodes; trim();
  };
  const weight = value => value.pages.reduce((sum, page) => sum + 1 + page.querySelectorAll('*').length, 0);
  return {
    get size() { return entries.size; },
    get nodeCount() { return nodes; },
    clear() { entries.clear(); nodes = 0; },
    remember(anchor, value) {
      // A restored text offset may normalize to the beginning of its leaf.
      // Count those pages once, even when the requested and normalized keys differ.
      let knownNodes;
      for (const [key, entry] of entries) if (entry.value?.pages === value.pages) { knownNodes = entry.nodes; remove(key); }
      store(keyFor(anchor), { value, nodes: knownNodes ?? weight(value), promise: Promise.resolve(value) });
    },
    get(anchor) {
      const key = keyFor(anchor);
      if (entries.has(key)) {
        const entry = entries.get(key);
        entries.delete(key); entries.set(key, entry);
        return entry.promise;
      }
      const entry = { nodes: 0, promise: null };
      entry.promise = Promise.resolve().then(() => prepare(anchor)).then(value => {
        if (entries.get(key) === entry) {
          entry.value = value; entry.nodes = weight(value); nodes += entry.nodes;
          if (entry.nodes > maxNodes) remove(key);
          trim();
        }
        return value;
      }, error => {
        if (entries.get(key) === entry) remove(key);
        throw error;
      });
      store(key, entry);
      return entry.promise;
    },
  };
}
