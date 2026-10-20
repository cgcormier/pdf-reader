/** Navigation metadata is independent of the source-page reading layout. */
export const STRUCTURE_KINDS = ['part', 'chapter', 'section', 'appendix', 'frontmatter', 'heading'];

/** Explicit stop/manual choices take precedence over detector upgrades. */
export function shouldAutoScanStructure(structure, version) {
  if (['cancelled', 'manual'].includes(structure?.status)) return false;
  return structure?.status !== 'complete' || structure.version !== version;
}

export function structureFromLegacy(chapters = [], totalPages = 1, manual = false) {
  return {
    version: 0, status: manual ? 'manual' : 'pending', totalPages,
    scannedPages: [], failedPages: [], candidates: [], textPages: 0, tocUnresolved: 0,
    nodes: chapters.map((chapter, index) => ({
      id: `legacy-${index}`, parentId: null, kind: 'chapter', level: 0,
      title: chapter.title, page: chapter.page, y: null,
      source: manual ? 'manual' : 'legacy', confidence: 'high', evidence: ['Saved contents'],
    })),
  };
}

export function structureNodes(structure, edits = {}, totalPages = structure?.totalPages || 1) {
  const byId = new Map((structure?.nodes || []).map(node => [node.id, { ...node }]));
  for (const [id, edit] of Object.entries(edits || {})) {
    if (edit.hidden) { byId.delete(id); continue; }
    const previous = byId.get(id);
    if (!previous && !edit.title) continue;
    byId.set(id, { ...previous, ...edit, id, source: 'manual', confidence: 'high', evidence: ['Your correction'] });
  }
  // A saved manual arrangement can predate stable detection IDs. Its entries
  // take priority over automatic entries of the same type on the same page.
  const manual = [...byId.values()].filter(node => node.source === 'manual' && node.id.startsWith('legacy-'));
  const replacements = new Map();
  for (const [id, node] of byId) {
    const replacement = node.source !== 'manual' && manual.find(entry => entry.page === node.page && entry.kind === node.kind && entry.id !== id);
    if (replacement) { byId.delete(id); replacements.set(id, replacement.id); }
  }
  // An accepted suggestion can become a confident detection with a different
  // ID. Retain the user's entry only when the same anchor matches uniquely.
  const corrected = [...byId.values()].filter(node => node.source === 'manual');
  const automatic = [...byId.values()].filter(node => node.source !== 'manual');
  const titleKey = title => String(title ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const sameAnchor = (a, b) => a.page === b.page && a.kind === b.kind && titleKey(a.title) === titleKey(b.title)
    && (!Number.isFinite(a.y) || !Number.isFinite(b.y) || Math.abs(a.y - b.y) < 3);
  for (const entry of corrected) {
    const matches = automatic.filter(node => sameAnchor(entry, node));
    if (matches.length !== 1 || corrected.filter(node => sameAnchor(node, matches[0])).length !== 1) continue;
    const replacement = matches[0];
    byId.delete(replacement.id); replacements.set(replacement.id, entry.id);
  }
  const nodes = [...byId.values()].filter(node =>
    typeof node.title === 'string' && node.title.trim() && Number.isInteger(node.page)
    && node.page >= 1 && node.page <= totalPages);
  const valid = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    node.title = node.title.trim();
    node.kind = STRUCTURE_KINDS.includes(node.kind) ? node.kind : 'heading';
    node.y = Number.isFinite(node.y) ? node.y : null;
    node.parentId = replacements.get(node.parentId) || node.parentId;
    if (!valid.has(node.parentId) || node.parentId === node.id) node.parentId = null;
    if (valid.get(node.parentId)?.page > node.page) node.parentId = null;
    const seen = new Set([node.id]);
    let parent = valid.get(node.parentId);
    while (parent) {
      if (seen.has(parent.id)) { node.parentId = null; break; }
      seen.add(parent.id); parent = valid.get(parent.parentId);
    }
  }
  nodes.sort((a, b) => a.page - b.page || ((b.y ?? Infinity) - (a.y ?? Infinity) || 0));
  return nodes;
}

export function structurePath(nodes, id) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const path = [];
  const seen = new Set();
  let node = byId.get(id);
  while (node && !seen.has(node.id)) {
    path.unshift(node); seen.add(node.id); node = byId.get(node.parentId);
  }
  return path;
}

/** Page-only movement cannot distinguish two headings on the same source page. */
export function activeStructureNode(nodes, page, selectedId = null) {
  const selected = nodes.find(node => node.id === selectedId && node.page === page);
  if (selected) return selected;
  const eligible = nodes.filter(node => node.page <= page);
  const latestPage = eligible.at(-1)?.page;
  const samePage = eligible.filter(node => node.page === latestPage);
  return samePage.find(node => node.kind === 'chapter')
    || samePage.find(node => node.parentId === null) || samePage[0] || nodes[0];
}

/** Legacy chapters remain useful for the book typography, with one start per page. */
export function chaptersFromNodes(nodes) {
  const entries = nodes.filter(node => !['part', 'section'].includes(node.kind));
  const unique = [];
  for (const node of entries) {
    if (!unique.some(entry => entry.page === node.page)) unique.push({ title: node.title, page: node.page, kind: node.kind });
  }
  if (!unique.length) unique.push({ title: 'Entire book', page: 1, kind: 'heading' });
  if (unique[0].page > 1) unique.unshift({ title: 'Opening pages', page: 1, kind: 'frontmatter' });
  return unique;
}

/** A replacement scan cannot publish into another book, even if it ignores abort. */
export function createStructureScanner(analyze, { onUpdate, onError, onFinish } = {}) {
  let current = null;
  return {
    get running() { return current !== null; },
    cancel() { const job = current; current = null; job?.controller.abort(); },
    async start(pdf, initial) {
      this.cancel();
      const job = { controller: new AbortController() };
      current = job;
      try {
        const result = await analyze(pdf, {
          initial, signal: job.controller.signal,
          onUpdate: value => { if (current === job && !job.controller.signal.aborted) onUpdate?.(value); },
        });
        if (current === job && !job.controller.signal.aborted) onUpdate?.(result);
      } catch (error) {
        if (current === job && !job.controller.signal.aborted && error.name !== 'AbortError') onError?.(error);
      } finally {
        if (current === job) { current = null; onFinish?.(); }
      }
    },
  };
}
