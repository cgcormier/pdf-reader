export const STRUCTURE_VERSION = 2;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function waitAbort(value, signal) {
  checkAbort(signal);
  if (!signal) return Promise.resolve(value);
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then((result) => { signal.removeEventListener('abort', abort); resolve(result); }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
const stableId = (value) => {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `structure-${(hash >>> 0).toString(36)}`;
};
function titleKey(title) {
  const words = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
  return clean(title).toLocaleLowerCase().replace(new RegExp(`^(?:part|chapter|section|book|appendix)\\s+(?:\\d+(?:\\.\\d+)*|[ivxlcdm]{1,12}|(?:${words})|[a-z])\\s*[:.\\-–—]?\\s*`, 'i'), '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function classify(title) {
  const text = clean(title);
  const play = playHeading(text);
  if (play) return { kind: play.family === 'act' ? 'part' : 'chapter', level: play.family === 'act' ? 1 : 2 };
  const decimal = text.match(/^(\d+(?:\.\d+)+)\b/);
  if (decimal) return { kind: 'section', level: decimal[1].split('.').length };
  const m = text.match(/^(part|chapter|section|book|appendix)\s+([\w.-]+)/i);
  if (/^(?:preface|foreword|introduction|prologue|acknowledgements|acknowledgments|dedication|contents|table of contents|index|glossary|references|bibliography)$/i.test(text)) return { kind: 'frontmatter', level: 1 };
  if (!m) return { kind: 'heading', level: 2 };
  const k = m[1].toLowerCase();
  if (k === 'part' || k === 'book') return { kind: 'part', level: 1 };
  if (k === 'appendix') return { kind: 'appendix', level: 1 };
  if (k === 'chapter') return { kind: 'chapter', level: 1 };
  const decimals = m[2].match(/\d+/g) ?? [];
  return { kind: 'section', level: Math.max(2, decimals.length + 1) };
}
function sectionNumber(title) {
  const match = clean(title).match(/^(?:section\s+)?(\d+(?:\.\d+)+)\b/i);
  return match ? match[1].split('.').map((part) => String(Number(part))) : null;
}
function chapterNumber(title) {
  const match = clean(title).match(/^(?:chapter|book)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+|[ivxlcdm]{1,12})\b/i);
  if (!match) return null;
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const wordIndex = words.indexOf(match[1].toLowerCase());
  return wordIndex >= 0 ? String(wordIndex + 1) : String(Number(match[1]) || romanNumber(match[1]) || match[1]).toLowerCase();
}
function baseNode({ title, parentId = null, page, y = null, source, confidence, evidence = [], level, kind, pageLabel }) {
  const inferred = classify(title);
  const finalKind = kind ?? inferred.kind;
  const finalLevel = level ?? inferred.level;
  const idSeed = `${source}|${titleKey(title)}|${page}|${y == null ? '' : Math.round(y * 10) / 10}|${parentId ?? ''}`;
  return { id: stableId(idSeed), parentId, title: clean(title), kind: finalKind, page, y, level: finalLevel, source, confidence, evidence, ...(pageLabel ? { pageLabel } : {}) };
}
function blankStructure(pdf, pageLabels) {
  return { version: STRUCTURE_VERSION, nodes: [], candidates: [], scannedPages: [], failedPages: [], totalPages: Number(pdf.numPages) || 0, status: 'pending', textPages: 0, tocUnresolved: 0, ...(pageLabels ? { pageLabels } : {}) };
}
function parseDestination(dest) {
  if (!Array.isArray(dest) || !dest.length) return { first: null, y: null };
  const mode = String(dest[1]?.name ?? dest[1] ?? '').toLowerCase();
  let y = null;
  if (mode === 'xyz' && dest[3] != null && Number.isFinite(Number(dest[3]))) y = Number(dest[3]);
  if ((mode === 'fith' || mode === 'fitbh') && dest[2] != null && Number.isFinite(Number(dest[2]))) y = Number(dest[2]);
  return { first: dest[0], y };
}
async function destinationAnchor(pdf, raw, signal) {
  let dest = raw;
  if (typeof dest === 'string') {
    try { dest = await waitAbort(pdf.getDestination?.(dest), signal); } catch (error) { if (error?.name === 'AbortError') throw error; return null; }
  }
  const parsed = parseDestination(dest);
  let index = parsed.first;
  if (index && typeof index === 'object') {
    try { index = await waitAbort(pdf.getPageIndex?.(index), signal); } catch (error) { if (error?.name === 'AbortError') throw error; return null; }
  }
  if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return null;
  return { page: index + 1, y: parsed.y };
}
async function getLabels(pdf, signal) {
  try { const value = await waitAbort(pdf.getPageLabels?.(), signal); return Array.isArray(value) ? value.map((x) => clean(x)) : undefined; }
  catch (error) { if (error?.name === 'AbortError') throw error; return undefined; }
}
async function outlineNodes(pdf, labels, signal) {
  let outline;
  try { outline = await waitAbort(pdf.getOutline?.(), signal); } catch (error) { if (error?.name === 'AbortError') throw error; return []; }
  const result = [];
  const walk = async (items, parentId = null, ancestry = []) => {
    for (const item of items ?? []) {
      checkAbort(signal);
      const title = clean(item?.title);
      const isExternal = item?.url || item?.unsafeUrl || item?.action;
      const anchor = item?.dest == null ? null : await destinationAnchor(pdf, item.dest, signal);
      let currentParent = parentId;
      if (!isExternal && title) {
        if (anchor) {
          const node = baseNode({ title, parentId, page: anchor.page, y: anchor.y, source: 'outline', confidence: 'high', evidence: ['PDF outline destination'], pageLabel: labels?.[anchor.page - 1] || undefined });
          result.push(node); currentParent = node.id;
        } else if (item?.items?.length) {
          // Preserve destination-less grouping labels when a descendant supplies a usable anchor.
          const descendant = await firstDescendantAnchor(pdf, item.items, signal);
          if (descendant) {
            const node = baseNode({ title, parentId, page: descendant.page, y: descendant.y, source: 'outline', confidence: 'medium', evidence: ['Outline group anchored by first valid descendant'], pageLabel: labels?.[descendant.page - 1] || undefined });
            result.push(node); currentParent = node.id;
          }
        }
      }
      const nextAncestry = title && !isExternal ? [...ancestry, title] : ancestry;
      await walk(item?.items, currentParent, nextAncestry);
    }
  };
  await walk(outline);
  return result;
}
async function firstDescendantAnchor(pdf, items, signal) {
  for (const item of items ?? []) {
    checkAbort(signal);
    if (item?.dest != null) { const found = await destinationAnchor(pdf, item.dest, signal); if (found) return found; }
    const nested = await firstDescendantAnchor(pdf, item?.items, signal);
    if (nested) return nested;
  }
  return null;
}

function itemGeometry(item) {
  const t = item?.transform ?? [];
  const x = Number(t[4]) || 0; const y = Number(t[5]) || 0;
  const sx = Math.hypot(Number(t[0]) || 0, Number(t[1]) || 0);
  const sy = Math.hypot(Number(t[2]) || 0, Number(t[3]) || 0);
  const angle = Math.atan2(Number(t[1]) || 0, Number(t[0]) || 0);
  return { x, y, size: Math.max(1, sx, sy), angle, width: Math.max(0, Number(item?.width) || String(item?.str ?? '').length * Math.max(1, sx) * .45) };
}
function pageLines(content) {
  const items = (content?.items ?? []).filter((i) => typeof i?.str === 'string' && clean(i.str));
  // Group by baseline and orientation, then split a line at a wide column gap.
  const lines = [];
  for (const item of items) {
    const g = itemGeometry(item);
    let line = lines.find((l) => Math.abs(l.angle - g.angle) < .08 && Math.abs(l.y - g.y) <= Math.max(2, g.size * .22));
    if (!line) lines.push(line = { angle: g.angle, y: g.y, entries: [] });
    line.entries.push({ item, g });
  }
  const splitLines = [];
  for (const line of lines) {
    const ordered = line.entries.sort((a, b) => a.g.x - b.g.x);
    const fullEntries = ordered.map(({ item, g }) => ({ text: clean(item.str), x: g.x, right: g.x + g.width, size: g.size })).filter((e) => e.text);
    const fullText = fullEntries.map((e) => e.text).join(' ');
    let group = [];
    for (const entry of ordered) {
      const previous = group.at(-1);
      if (previous && entry.g.x - (previous.g.x + previous.g.width) > Math.max(110, entry.g.size * 8)) {
        splitLines.push({ ...line, entries: group, fullText, fullEntries }); group = [];
      }
      group.push(entry);
    }
    if (group.length) splitLines.push({ ...line, entries: group, fullText, fullEntries });
  }
  return splitLines.map((line) => {
    const entries = line.entries;
    let text = ''; let right = null;
    for (const { item, g } of entries) {
      const part = clean(item.str); if (!part) continue;
      if (text && (right == null || g.x - right > g.size * .2 || item.hasEOL)) text += ' ';
      text += part;
      right = item.hasEOL ? null : g.x + g.width;
    }
    return { text: clean(text), fullText: clean(line.fullText), fullEntries: line.fullEntries, y: line.y, size: Math.max(...entries.map((e) => e.g.size)), x: Math.min(...entries.map((e) => e.g.x)), right: Math.max(...entries.map((e) => e.g.x + e.g.width)) };
  }).filter((l) => l.text).sort((a, b) => b.y - a.y || a.x - b.x);
}
function romanNumber(text) {
  const s = String(text).toUpperCase();
  if (!/^(?=[MDCLXVI]+$)M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(s)) return null;
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let out = 0; for (let i = 0; i < s.length; i++) out += (map[s[i]] < (map[s[i + 1]] || 0) ? -1 : 1) * map[s[i]];
  return out || null;
}
function playHeading(text) {
  const match = clean(text).match(/^(act|scene)\s+(\d{1,3}|[ivxlcdm]{1,12})\.?$/i);
  if (!match) return null;
  const number = /^\d+$/.test(match[2]) ? Number(match[2]) : romanNumber(match[2]);
  if (!number) return null;
  const family = match[1].toLowerCase();
  return { family, number, title: `${family === 'act' ? 'Act' : 'Scene'} ${match[2].toUpperCase()}` };
}
function explicitHeading(text) {
  const decimal = clean(text).match(/^(\d{1,3}(?:\.\d+)+)(?:\s*[:.\-–—]\s*|\s+)(.*)$/);
  if (decimal) return { title: `${decimal[1]}: ${clean(decimal[2])}`, bare: !clean(decimal[2]) };
  const m = clean(text).match(/^(part|chapter|section|book|appendix)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d{1,3}(?:\.\d+)*|[ivxlcdm]{1,12}|[a-z])\b(?:\s*[:.\-–—]\s*|\s+)?(.*)$/i);
  if (!m) return null;
  const tail = clean(m[3]);
  if (/(?:\.{2,}|…|·{2,}|\s\s+)\s*(?:[ivxlcdm]+|\d{1,4})$/i.test(text)) return null;
  if (tail && !/^\p{Lu}/u.test(tail)) return null;
  return { title: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${tail ? `: ${tail}` : ''}`, bare: !tail };
}
function parseTocEntry(items) {
  if (!items?.length) return null;
  const fullText = clean(items.map((item) => item.text).join(' '));
  // A title's own ordinal is not a separate page-reference field.
  if (/^(?:(?:act|scene|part|chapter|section|book|appendix)\s+(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])\.?|act\s+(?:\d+|[ivxlcdm]+)\.?\s+(?:scene|sc\.)\s+(?:\d+|[ivxlcdm]+)\.?)$/i.test(fullText)) return null;
  const last = items.at(-1);
  if (items.length === 1) {
    const match = last.text.match(/^(.{2,100}?)\s*(?:(?:\.{2,}|…+|·{2,})\s*|\s+)([ivxlcdm]{1,12}|\d{1,4})$/i);
    if (match) return { title: clean(match[1].replace(/(?:\.{2,}|…+|·{2,})/g, ' ')), label: match[2], leader: /(?:\.{2,}|…+|·{2,})\s*(?:[ivxlcdm]+|\d+)$/i.test(last.text) };
  }
  if (!/^(?:[ivxlcdm]{1,12}|\d{1,4})$/i.test(last.text)) return null;
  const before = items.slice(0, -1);
  if (!before.length) return null;
  const previous = before.at(-1);
  const separated = last.x - previous.right > Math.max(12, last.size * .6);
  const hasLeader = /(?:\.{2,}|…+|·{2,})$/.test(previous.text);
  if (!separated && !hasLeader) return null;
  const title = clean(before.map((item) => item.text).join(' ').replace(/(?:\.{2,}|…+|·{2,})/g, ' '));
  if (before.some((item) => /^\d+(?:\.\d+)?$/.test(item.text)) && !explicitHeading(title) && !playHeading(title)) return null;
  return title.length >= 2 && title.length <= 100 ? { title, label: last.text, leader: hasLeader } : null;
}
function tocPageEvidence(lines, view) {
  const rows = [...new Map(lines.map((line) => [line.fullEntries, line])).values()];
  const labelled = rows.some((line) => /^(?:contents|table of contents)$/i.test(line.fullText));
  const entries = rows.map((line) => ({ line, parsed: parseTocEntry(line.fullEntries) })).filter(({ parsed }) => parsed);
  const bodyRows = rows.filter((line) => !looksRunning(line, view));
  const compact = entries.filter(({ parsed }) => parsed.title.length <= 80 && !/[.!?;]$/.test(parsed.title));
  const density = compact.length / Math.max(1, bodyRows.length);
  const leaders = compact.filter(({ parsed }) => parsed.leader);
  const numbered = compact.filter(({ parsed }) => explicitHeading(parsed.title) || playHeading(parsed.title) || classify(parsed.title).kind === 'frontmatter');
  const aligned = compact.length >= 3 && compact.every(({ line }) => Math.abs(line.fullEntries.at(-1).right - compact[0].line.fullEntries.at(-1).right) <= 12);
  // An aligned column alone also describes tables and dialogue line counters.
  const qualified = labelled || (leaders.length >= 2 && density >= .5)
    || leaders.some(({ parsed }) => explicitHeading(parsed.title) || playHeading(parsed.title))
    || (aligned && density >= .6 && numbered.length >= compact.length * .6);
  return { entries: qualified ? entries : [], labelled, bottom: entries.length ? Math.min(...entries.map(({ line }) => line.y)) : null };
}
function median(values) { const a = [...values].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * .4)] : 10; }
function looksRunning(line, view) {
  const height = Number(view?.[3]) - Number(view?.[1]);
  if (height <= 0) return false;
  return line.y < Number(view[1]) + height * .065 || line.y > Number(view[3]) - height * .055;
}
function pageLabelMap(labels) {
  const map = new Map(); (labels ?? []).forEach((label, i) => { if (label) { const key = String(label).toLowerCase(); map.set(key, [...(map.get(key) ?? []), i + 1]); } }); return map;
}
function mergeNode(nodes, node) {
  const key = titleKey(node.title);
  const existing = nodes.find((n) => titleKey(n.title) === key && n.page === node.page && (n.y == null || node.y == null || Math.abs(n.y - node.y) < 3));
  if (!existing) { nodes.push(node); return node; }
  const rank = { fallback: 0, headings: 1, toc: 2, outline: 3 };
  if (rank[node.source] > rank[existing.source]) {
    existing.source = node.source; existing.confidence = node.confidence; existing.evidence = [...new Set([...existing.evidence, ...node.evidence])];
  } else existing.evidence = [...new Set([...existing.evidence, ...node.evidence])];
  if (existing.y == null) existing.y = node.y;
  return existing;
}
function normalizeParentLinks(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) if (n.parentId === n.id || (n.parentId && !byId.has(n.parentId))) n.parentId = null;
  for (const n of nodes) {
    const seen = new Set([n.id]); let p = n.parentId;
    while (p) { if (seen.has(p)) { n.parentId = null; break; } seen.add(p); p = byId.get(p)?.parentId ?? null; }
  }
}

/** Read page labels and the complete outline without scanning page text. */
export async function readDocumentStructure(pdf, { signal } = {}) {
  checkAbort(signal);
  const labels = await getLabels(pdf, signal);
  const structure = blankStructure(pdf, labels);
  structure.nodes = await outlineNodes(pdf, labels, signal);
  if (structure.nodes.length && Math.min(...structure.nodes.map((n) => n.page)) > 1) {
    structure.nodes.push(baseNode({ title: 'Opening pages', page: 1, source: 'fallback', confidence: 'medium', evidence: ['Pages before the first outline destination'], kind: 'frontmatter', level: 0 }));
  }
  normalizeParentLinks(structure.nodes);
  checkAbort(signal);
  return structure;
}

function snapshotOf(state) { return { ...state, nodes: state.nodes.map((n) => ({ ...n, evidence: [...n.evidence] })), candidates: state.candidates.map((c) => ({ ...c, evidence: [...(c.evidence ?? [])] })), scannedPages: [...state.scannedPages], failedPages: [...state.failedPages], ...(state.pageLabels ? { pageLabels: [...state.pageLabels] } : {}), _outlineNodes: state._outlineNodes.map((n) => ({ ...n, evidence: [...n.evidence] })), _baseCandidates: [...state._baseCandidates] }; }

/** Scan every physical page incrementally. The PDF remains owned by the caller. */
export async function analyzeDocumentStructure(pdf, { signal, onProgress, onUpdate, initial } = {}) {
  checkAbort(signal);
  // Evidence and scanned-page markers are detector-version specific, even for
  // direct callers that do not use the app's upgrade policy.
  const seed = initial?.version === STRUCTURE_VERSION && initial.totalPages === Number(pdf.numPages)
    ? initial : await readDocumentStructure(pdf, { signal });
  const baseNodes = seed._outlineNodes ?? (seed.nodes ?? []).filter((n) => n.source === 'outline' || (n.source === 'fallback' && n.title === 'Opening pages'));
  const state = { ...blankStructure(pdf, seed.pageLabels), ...seed, totalPages: Number(pdf.numPages) || 0, nodes: (seed.nodes ?? []).map((n) => ({ ...n, evidence: [...(n.evidence ?? [])] })), candidates: [...(seed.candidates ?? [])], scannedPages: [...new Set(seed.scannedPages ?? [])], failedPages: [...new Set(seed.failedPages ?? [])], _headingEvidence: [...(seed._headingEvidence ?? [])], _tocEvidence: [...(seed._tocEvidence ?? [])], _outlineNodes: baseNodes.map((n) => ({ ...n, evidence: [...(n.evidence ?? [])] })), _baseCandidates: [...(seed._baseCandidates ?? [])], status: 'scanning' };
  const failed = new Set(state.failedPages);
  const scanned = new Set(state.scannedPages.filter((page) => !failed.has(page)));
  const labels = state.pageLabels;
  let sinceYield = 0;
  for (let pageNumber = 1; pageNumber <= state.totalPages; pageNumber++) {
    checkAbort(signal);
    if (!scanned.has(pageNumber)) {
      try {
        const page = await waitAbort(pdf.getPage(pageNumber), signal);
        const content = await waitAbort(page.getTextContent(), signal);
        checkAbort(signal);
        const lines = pageLines(content);
        if (lines.length) state.textPages += 1;
        failed.delete(pageNumber);
        const toc = tocPageEvidence(lines, page.view);
        const tocRows = new Set(toc.entries.map(({ line }) => line.fullEntries));
        for (const { line, parsed } of toc.entries) {
          const evidence = { title: parsed.title, label: parsed.label, tocPage: pageNumber, tocY: line.y };
          if (!state._tocEvidence.some((e) => e.tocPage === pageNumber && e.tocY === line.y && titleKey(e.title) === titleKey(evidence.title) && e.label === evidence.label)) state._tocEvidence.push(evidence);
        }
        {
          const bodySizes = lines.filter((l) => !looksRunning(l, page.view)).map((l) => l.size);
          const bodyMedian = median(bodySizes);
          const consumedTitleLines = new Set();
          for (let i = 0; i < lines.length; i++) {
            if (consumedTitleLines.has(i)) continue;
            const line = lines[i];
            if (tocRows.has(line.fullEntries)) continue;
            // A separate opening below the last Contents row may share its page.
            if (toc.labelled && (toc.bottom == null || line.y >= toc.bottom)) continue;
            const play = playHeading(line.text);
            if (play && line.text === line.fullText) {
              const previous = lines.slice(0, i).findLast((other) => other.y > line.y + 2);
              const next = lines.slice(i + 1).find((other) => other.y < line.y - 2);
              const above = previous ? previous.y - line.y : Infinity;
              const below = next ? line.y - next.y : Infinity;
              const spatial = above >= line.size * 2 && below >= line.size * .8 && below <= line.size * 5;
              const inMargin = looksRunning(line, page.view);
              if (!inMargin || (play.family === 'act' && spatial && below >= line.size * 2 && line.y > page.view[3] - (page.view[3] - page.view[1]) * .055)) {
                const evidence = { title: play.title, page: pageNumber, y: line.y, size: line.size, median: bodyMedian,
                  style: `play:${play.family}:${Math.round(line.size / Math.max(1, bodyMedian) * 10) / 10}:${Math.round(line.x / 25)}`,
                  explicit: true, play: { ...play, spatial }, evidence: ['Standalone numbered play heading', ...(spatial ? ['Whitespace separates the heading from surrounding text'] : [])] };
                if (!state._headingEvidence.some((h) => h.page === pageNumber && titleKey(h.title) === titleKey(play.title) && Math.abs(h.y - line.y) < 2)) state._headingEvidence.push(evidence);
              }
              continue;
            }
            if (/^(?:act|scene)\b/i.test(line.text)) continue;
            if (looksRunning(line, page.view)) continue;
            let parsed = explicitHeading(line.text); let display = parsed?.title; let y = line.y;
            if (parsed?.bare) {
              const next = lines[i + 1];
              if (next && next.text.length <= 110 && next.size >= bodyMedian * 1.12 && line.y - next.y < Math.max(line.size * 3, 28) && /^\p{Lu}/u.test(next.text)) { display = `${parsed.title}: ${next.text}`; consumedTitleLines.add(i + 1); }
              else if (line.size < bodyMedian * 1.22) display = null;
            }
            if (display) {
              const evidence = { title: display, page: pageNumber, y, size: line.size, median: bodyMedian, style: `${Math.round(line.size / Math.max(1, bodyMedian) * 10) / 10}:${Math.round(line.x / 25)}`, explicit: true, evidence: ['Explicit numbered heading'] };
              if (!state._headingEvidence.some((h) => h.page === pageNumber && titleKey(h.title) === titleKey(display) && Math.abs(h.y - y) < 2)) state._headingEvidence.push(evidence);
            }
            else if (line.size >= bodyMedian * 1.45 && line.text.length >= 4 && line.text.length <= 90 && !/^\d+$/.test(line.text) && !/^(?:figure|fig\.|table|plate|copyright|contents|chapter|part|section)\b/i.test(line.text)) {
              const next = lines[i + 1];
              if (next && next.size < line.size * .85 && line.y - next.y < Math.max(line.size * 3, 30)) {
                const evidence = { title: line.text, page: pageNumber, y, size: line.size, median: bodyMedian, style: `${Math.round(line.size / Math.max(1, bodyMedian) * 10) / 10}:${Math.round(line.x / 25)}`, explicit: false, evidence: ['Prominent standalone typography'] };
                if (!state._headingEvidence.some((h) => h.page === pageNumber && titleKey(h.title) === titleKey(line.text) && Math.abs(h.y - y) < 2)) state._headingEvidence.push(evidence);
              }
            }
          }
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        failed.add(pageNumber);
      }
      scanned.add(pageNumber); sinceYield += 1;
    }
    state.scannedPages = [...scanned].sort((a, b) => a - b); state.failedPages = [...failed].sort((a, b) => a - b);
    state.textPages = Math.max(state.textPages, Number(seed.textPages) || 0);
    onProgress?.({ scanned: scanned.size, total: state.totalPages, page: pageNumber });
    if (sinceYield >= 8 && pageNumber < state.totalPages) {
      await waitAbort(new Promise((resolve) => setTimeout(resolve, 0)), signal); sinceYield = 0;
      checkAbort(signal); finalize(state, labels); onUpdate?.(snapshotOf(state));
    }
  }
  checkAbort(signal);
  finalize(state, labels);
  state.status = 'complete';
  checkAbort(signal); onUpdate?.(snapshotOf(state));
  return snapshotOf(state);
}

function makeCandidate({ title, page = null, y = null, source, pageLabel, evidence, context = '' }) {
  const inferred = classify(title);
  const playIdentity = playHeading(title) ? `|${y == null ? '' : Math.round(y * 10) / 10}|${context}` : '';
  return { id: stableId(`candidate|${source}|${titleKey(title)}|${page ?? ''}|${pageLabel ?? ''}${playIdentity}`), parentId: null, title: clean(title), kind: inferred.kind, page, y, level: inferred.level, source, confidence: 'low', evidence: [...evidence], ...(pageLabel ? { pageLabel } : {}) };
}
function anchorOrder(a, b) {
  if (a.page !== b.page) return a.page - b.page;
  if (a.parentId && a.parentId === b.id) return 1;
  if (b.parentId && b.parentId === a.id) return -1;
  // A coordinate-less outline destination means the page opening. Explicit
  // positions still order separate boundaries on that same page.
  const ay = a.y ?? (a.source === 'outline' ? Infinity : 0);
  const by = b.y ?? (b.source === 'outline' ? Infinity : 0);
  return ay === by ? (a.level ?? 0) - (b.level ?? 0) : by - ay;
}
function titlesMatch(title, target) {
  const a = playHeading(title); const b = playHeading(target);
  if (a || b) return Boolean(a && b && a.family === b.family && a.number === b.number);
  const key = titleKey(target); const other = titleKey(title);
  return key ? other === key || other.includes(key) : clean(title).toLowerCase() === clean(target).toLowerCase();
}
function crediblePlayHeadings(headings) {
  const plays = headings.filter((h) => h.play?.spatial).sort(anchorOrder);
  const parents = new Map(); let act = null;
  for (const h of plays) {
    if (h.play.family === 'act') act = h;
    else parents.set(h, act);
  }
  const credible = new Set();
  const advances = (other, h) => anchorOrder(other, h) < 0
    ? other.play.number === h.play.number - 1 : other.play.number === h.play.number + 1;
  for (const h of plays.filter((value) => value.play.family === 'act')) {
    const firstScene = plays.find((value) => parents.get(value) === h);
    const repeated = plays.filter((other) => other.play.family === 'act' && other.play.number === h.play.number).length > 1;
    const sequence = !repeated && plays.some((other) => other !== h && other.play.family === 'act' && other.style === h.style && advances(other, h));
    if (firstScene?.play.number === 1 || sequence) credible.add(h);
  }
  for (const h of plays.filter((value) => value.play.family === 'scene')) {
    const parent = parents.get(h);
    const sequence = plays.some((other) => other !== h && other.play.family === 'scene' && other.style === h.style
      && parents.get(other) === parent && advances(other, h));
    if (sequence || (h.play.number === 1 && parent && credible.has(parent))) credible.add(h);
  }
  return credible;
}

function finalize(state, labels) {
  const headings = state._headingEvidence ?? [];
  const counts = new Map();
  for (const h of headings) { const k = titleKey(h.title); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const stylePages = new Map();
  for (const h of headings) if (h.style) {
    if (!stylePages.has(h.style)) stylePages.set(h.style, new Set());
    stylePages.get(h.style).add(h.page);
  }
  const nodes = state._outlineNodes.map((n) => ({ ...n, evidence: [...n.evidence] }));
  state.candidates = [...state._baseCandidates];
  state.tocUnresolved = 0;
  const labelMap = pageLabelMap(labels);
  const toc = state._tocEvidence ?? [];
  const playHeadings = crediblePlayHeadings(headings);
  const headingInfo = headings.map((h) => {
    const prominent = h.size >= h.median * 1.35;
    const styleCorroborated = (stylePages.get(h.style)?.size ?? 0) >= 2;
    return { h, prominent, styleCorroborated, credible: h.play ? playHeadings.has(h) : h.explicit ? prominent : prominent && styleCorroborated };
  });
  const firstProminent = new Map();
  for (const info of headingInfo) if (info.prominent && !firstProminent.has(titleKey(info.h.title))) firstProminent.set(titleKey(info.h.title), info.h);
  const repeatedRunning = (h) => (counts.get(titleKey(h.title)) ?? 0) >= 3
    && (h.play ? h.play.family === 'act' && !playHeadings.has(h) : firstProminent.get(titleKey(h.title)) !== h);

  // Only already-credible headings can establish an offset. A TOC target may
  // then corroborate a weaker explicit heading at that exact page.
  const calibrations = [];
  for (const entry of toc) {
    const matches = headingInfo.filter(({ h, credible }) => credible && titlesMatch(h.title, entry.title));
    if (matches.length === 1) {
      const match = matches[0];
      const printed = Number(entry.label) || romanNumber(entry.label);
      if (printed) calibrations.push({ offset: match.h.page - printed, page: match.h.page, scheme: /^\d+$/.test(entry.label) ? 'numeric' : 'roman' });
    }
  }
  const offsetsByScheme = new Map();
  for (const c of calibrations) {
    if (!offsetsByScheme.has(c.scheme)) offsetsByScheme.set(c.scheme, new Map());
    const offsets = offsetsByScheme.get(c.scheme);
    if (!offsets.has(c.offset)) offsets.set(c.offset, new Set());
    offsets.get(c.offset).add(c.page);
  }
  const trustedOffsets = new Map();
  for (const [scheme, offsets] of offsetsByScheme) {
    const best = [...offsets].sort((a, b) => b[1].size - a[1].size)[0];
    if (best && best[1].size >= 2 && [...offsets.values()].filter((pages) => pages.size === best[1].size).length === 1) trustedOffsets.set(scheme, best[0]);
  }
  const resolvedToc = toc.map((entry) => {
    const labelPages = labelMap.get(entry.label.toLowerCase()) ?? [];
    const numeric = Number(entry.label) || romanNumber(entry.label);
    const scheme = /^\d+$/.test(entry.label) ? 'numeric' : 'roman';
    const mapped = labelPages.length === 1 ? labelPages[0] : trustedOffsets.has(scheme) ? numeric + trustedOffsets.get(scheme) : null;
    const page = Number.isInteger(mapped) && mapped >= 1 && mapped <= state.totalPages ? mapped : null;
    const matches = page ? headingInfo.filter(({ h }) => h.page === page && titlesMatch(h.title, entry.title)) : [];
    const heading = matches.length === 1 ? matches[0].h : null;
    return { entry, page, heading };
  });
  const tocMatchedHeadings = new Set(resolvedToc.filter((item) => item.page && item.heading).map((item) => item.heading));
  const outlineCorroborates = (h) => nodes.some((node) => node.source === 'outline' && node.page === h.page
    && titlesMatch(node.title, h.title));
  for (const h of headings) {
    const info = headingInfo.find((value) => value.h === h);
    if (repeatedRunning(h)) continue;
    const corroborated = tocMatchedHeadings.has(h) || outlineCorroborates(h);
    if (!info.credible && !corroborated) {
      state.candidates.push(makeCandidate({ title: h.title, page: h.page, y: h.y, source: 'headings', evidence: [...h.evidence, info.prominent ? 'No outline, contents, or repeated-style corroboration' : 'Typography is close to body text'], pageLabel: labels?.[h.page - 1] })); continue;
    }
    const node = baseNode({ title: h.title, page: h.page, y: h.y, source: 'headings', confidence: info.credible ? 'high' : 'medium', evidence: h.evidence, pageLabel: labels?.[h.page - 1] || undefined });
    mergeNode(nodes, node);
  }
  for (const { entry, page, heading } of resolvedToc) {
    if (page && heading) {
      mergeNode(nodes, baseNode({ title: entry.title, page, source: 'toc', confidence: 'high', evidence: ['Printed contents entry corroborated by page heading'], pageLabel: labels?.[page - 1] || entry.label }));
    } else if (page) {
      state.candidates.push(makeCandidate({ title: entry.title, page, pageLabel: labels?.[page - 1] || entry.label, source: 'toc', context: `${entry.tocPage}|${entry.tocY}`, evidence: ['Contents page reference has no matching extracted heading'] }));
    } else {
      state.candidates.push(makeCandidate({ title: entry.title, page: null, pageLabel: entry.label, source: 'toc', context: `${entry.tocPage}|${entry.tocY}`, evidence: ['Printed page label could not be mapped confidently'] }));
      state.tocUnresolved += 1;
    }
  }
  // Infer hierarchy for scanned headings while preserving explicit outline links.
  const ordered = nodes.sort(anchorOrder);
  const byId = new Map(ordered.map((n) => [n.id, n]));
  const ancestry = (node) => {
    const chain = []; const seen = new Set(); let parentId = node.parentId;
    while (parentId && byId.has(parentId) && !seen.has(parentId)) { seen.add(parentId); const parent = byId.get(parentId); chain.unshift(parent); parentId = parent.parentId; }
    return chain;
  };
  const prior = [];
  for (const node of ordered) {
    if (node.source === 'fallback') continue;
    if (node.source === 'outline' && node.parentId) {
      if (node.parentId) {
        const parentChain = ancestry(node);
        if (parentChain.length) node.level = Math.max(node.level, parentChain.at(-1).level + 1);
      }
      prior.push(node); continue;
    }
    if (node.source === 'outline') { prior.push(node); continue; }
    let boundaryIndex = -1;
    for (let i = 0; i < prior.length; i++) if (prior[i].kind === 'part' || prior[i].kind === 'appendix') boundaryIndex = i;
    const eligible = prior.slice(Math.max(0, boundaryIndex)).filter((candidate) => candidate.page <= node.page && candidate.id !== node.id);
    let parent = null;
    if (node.kind === 'part' || node.kind === 'appendix') {
      node.parentId = null;
    } else if (node.kind === 'chapter') {
      const boundary = eligible.find((candidate) => candidate.kind === 'part' || candidate.kind === 'appendix');
      if (boundary?.kind === 'part') parent = boundary;
    } else if (node.kind === 'section') {
      const number = sectionNumber(node.title);
      if (number?.length > 2) {
        const prefix = number.slice(0, -1).join('.');
        parent = [...eligible].reverse().find((candidate) => candidate.kind === 'section' && sectionNumber(candidate.title)?.join('.') === prefix);
      }
      if (!parent && number?.length === 2) {
        const chapterId = number[0];
        parent = [...eligible].reverse().find((candidate) => candidate.kind === 'chapter' && chapterNumber(candidate.title) === chapterId);
      }
      if (!parent) parent = [...eligible].reverse().find((candidate) => candidate.kind === 'chapter' || candidate.kind === 'appendix');
    }
    else parent = [...eligible].reverse().find((candidate) => ['part', 'chapter', 'section'].includes(candidate.kind));
    if (parent) {
      node.parentId = parent.id;
      node.level = Math.max(node.level, parent.level + 1);
    }
    prior.push(node);
  }
  if (!nodes.length) nodes.push(baseNode({ title: 'Entire book', page: 1, source: 'fallback', confidence: 'low', evidence: ['No readable outline or confident headings'], kind: 'heading', level: 0, pageLabel: labels?.[0] || undefined }));
  else if (Math.min(...nodes.map((n) => n.page)) > 1 && !nodes.some((n) => n.kind === 'frontmatter' && n.page === 1)) nodes.push(baseNode({ title: 'Opening pages', page: 1, source: 'fallback', confidence: 'medium', evidence: ['Pages before the first detected section'], kind: 'frontmatter', level: 0, pageLabel: labels?.[0] || undefined }));
  const candidates = new Map();
  for (const candidate of state.candidates) {
    if (candidate.page != null && (!Number.isInteger(candidate.page) || candidate.page < 1 || candidate.page > state.totalPages)) candidate.page = null;
    const existing = candidates.get(candidate.id);
    if (existing) existing.evidence = [...new Set([...existing.evidence, ...candidate.evidence])];
    else candidates.set(candidate.id, candidate);
  }
  state.candidates = [...candidates.values()];
  state.tocUnresolved = state.candidates.filter((candidate) => candidate.source === 'toc' && candidate.page == null).length;
  normalizeParentLinks(nodes); state.nodes = nodes;
}
