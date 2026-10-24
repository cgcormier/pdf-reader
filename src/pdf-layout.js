/** Deterministic, page-local interpretation. No PDF.js or DOM objects retained. */
export const LAYOUT_VERSION = 1;
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 10;
};
const representativeSize = runs => {
  const ordered = [...runs].sort((a, b) => a.size - b.size);
  const total = ordered.reduce((sum, r) => sum + clean(r.text).length, 0); let count = 0;
  return ordered.find(r => (count += clean(r.text).length) >= total / 2)?.size ?? 10;
};
const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function inversePoint(m, x, y) {
  const d = m[0] * m[3] - m[1] * m[2];
  return d ? [(m[3] * (x - m[4]) - m[2] * (y - m[5])) / d,
    (-m[1] * (x - m[4]) + m[0] * (y - m[5])) / d] : null;
}
const bounds = runs => ({ x: Math.min(...runs.map(r => r.x)), right: Math.max(...runs.map(r => r.right)),
  top: Math.min(...runs.map(r => r.top)), bottom: Math.max(...runs.map(r => r.bottom)) });
const isHeading = text => /^(?:(?:act|scene)\s+(?:[ivxlcdm]+|\d+)\.?|(?:part|chapter|book|section|appendix)\s+\S+.*|\d+(?:\.\d+)+\s+.+|preface|contents|table of contents)$/i.test(text);
const speakerMatch = text => {
  const match = text.match(/^([\p{Lu}][\p{Lu}\p{M}’'.-]*(?:\s+[\p{Lu}][\p{Lu}\p{M}’'.-]*){0,2})(?:\s+|$)/u);
  if (!match) return null;
  match[1] = match[1].replace(/(?:\s+\p{Lu})+$/u, '');
  return match[1].length > 1 ? match : null;
};

function capture(content, { pageNumber, view, viewport }) {
  const matrix = viewport?.transform?.length === 6 ? [...viewport.transform] : [1, 0, 0, -1, -view[0], view[3]];
  const marked = []; const runs = [];
  for (const [index, item] of (content.items ?? []).entries()) {
    if (typeof item.str !== 'string') {
      if (item.type === 'endMarkedContent') marked.pop();
      else if (item.type?.startsWith('beginMarkedContent')) marked.push(item.id ?? null);
      continue;
    }
    const t = [...(item.transform ?? [10, 0, 0, 10, 0, 0])];
    const size = Math.max(1, Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10);
    const [x, y] = point(matrix, t[4], t[5]);
    const vector = [matrix[0] * t[0] + matrix[2] * t[1], matrix[1] * t[0] + matrix[3] * t[1]];
    const angle = Math.atan2(vector[1], vector[0]);
    const style = { ...(content.styles?.[item.fontName] ?? {}) };
    const width = Math.max(0, Number(item.width) || item.str.length * size * .45);
    const ascent = Number.isFinite(style.ascent) ? style.ascent : .8;
    const descent = Number.isFinite(style.descent) ? style.descent : -.2;
    // Public TextItems have run geometry, not per-character boxes.
    const corners = [[0, -ascent * size], [width, -ascent * size], [0, -descent * size], [width, -descent * size]]
      .map(([u, v]) => [x + u * Math.cos(angle) - v * Math.sin(angle), y + u * Math.sin(angle) + v * Math.cos(angle)]);
    runs.push(Object.freeze({ id: `${pageNumber}:${index}`, page: pageNumber, index, text: item.str,
      transform: Object.freeze(t), sourceX: t[4], sourceY: t[5], baseline: y, angle, size, width,
      x: Math.min(...corners.map(c => c[0])), right: Math.max(...corners.map(c => c[0])),
      top: Math.min(...corners.map(c => c[1])), bottom: Math.max(...corners.map(c => c[1])),
      boxEstimated: true, style: Object.freeze(style), fontName: item.fontName ?? '', dir: item.dir ?? 'ltr',
      hasEOL: !!item.hasEOL, markedIds: Object.freeze(marked.filter(Boolean)) }));
  }
  return { runs: Object.freeze(runs), matrix };
}

function initials(runs, bodySize) {
  const found = new Map();
  const body = runs.filter(r => clean(r.text) && r.size < bodySize * 1.4 && Math.abs(r.angle) < .08);
  const candidates = runs.filter(r => /^\p{L}$/u.test(clean(r.text)) && r.size > bodySize * 1.65 && Math.abs(r.angle) < .08);
  for (const cap of candidates) {
    const adjacent = body.filter(r => r.x >= cap.right - bodySize * .3 && r.x - cap.right < bodySize * 1.25
      && r.baseline >= cap.top - bodySize * .3 && r.baseline <= cap.bottom + bodySize * .5
      && /^[“"'‘]?\p{Ll}/u.test(clean(r.text)) && !/[=+∑∫]/u.test(r.text));
    adjacent.sort((a, b) => a.baseline - b.baseline || a.index - b.index);
    const first = adjacent[0];
    if (!first || adjacent.some(r => r !== first && Math.abs(r.baseline - first.baseline) < bodySize * .35 && r.x < first.right - bodySize * .1)) continue;
    const lower = cap.baseline - first.baseline > bodySize * .45;
    const flowing = adjacent.some(r => r.baseline - first.baseline > bodySize * .65);
    const raised = Math.abs(cap.baseline - first.baseline) <= bodySize * .45;
    const before = body.some(r => r.x < cap.x && r.right > cap.x - bodySize && Math.abs(r.baseline - first.baseline) < bodySize * .3 && !/^[“"'‘]$/u.test(clean(r.text)));
    if (before || (lower && !flowing) || (!lower && !raised)) continue;
    // A neighboring column's initial must not jump across a gutter.
    if (candidates.some(other => other !== cap && Math.abs(other.right - cap.right) < bodySize && Math.abs(other.baseline - cap.baseline) < bodySize)) continue;
    found.set(cap.id, first.id);
  }
  return found;
}

function groupLines(runs, caps, size, width) {
  const buckets = new Map(); const rows = [];
  for (const run of [...runs].filter(r => clean(r.text) && !caps.has(r.id)).sort((a, b) => a.baseline - b.baseline || a.x - b.x || a.index - b.index)) {
    const key = Math.round(run.baseline / Math.max(1, size * .3));
    let line;
    for (let k = key - 1; k <= key + 1 && !line; k++) line = buckets.get(k)?.find(l => Math.abs(l.baseline - run.baseline) <= size * .28 && Math.abs(l.angle - run.angle) < .08);
    if (!line) {
      line = { rowId: rows.length, baseline: run.baseline, angle: run.angle, runs: [] }; rows.push(line);
      buckets.set(key, [...(buckets.get(key) ?? []), line]);
    }
    line.runs.push(run);
  }
  const byId = new Map(runs.map(r => [r.id, r]));
  for (const [cap, target] of caps) rows.find(row => row.runs.some(r => r.id === target))?.runs.push(byId.get(cap));
  const lines = [];
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x || a.index - b.index);
    row.tableLike = row.runs.filter(r => /^\d+(?:\.\d+)?$/.test(clean(r.text))).length >= 3;
    let group = [];
    for (const run of row.runs) {
      const prev = group.at(-1);
      const marginal = value => /^FTLN\s*\d+/i.test(clean(value.text));
      if (prev && (marginal(prev) || marginal(run) || run.x - prev.right > Math.max(size * 3, width * .035))) { lines.push({ ...row, runs: group }); group = []; }
      group.push(run);
    }
    if (group.length) lines.push({ ...row, runs: group });
  }
  return lines.map((line, index) => ({ ...line, ...bounds(line.runs), id: `line-${index}`, index,
    size: representativeSize(line.runs.filter(r => !caps.has(r.id))),
    sourceY: line.runs.find(r => !caps.has(r.id))?.sourceY ?? line.runs[0].sourceY,
    text: line.runs.map(r => clean(r.text)).join(' '), caps: line.runs.filter(r => caps.has(r.id)).map(r => r.id) }));
}

function annotationLines(lines, { width, height, pageNumber }, size) {
  const result = new Map();
  const contents = lines.some(l => /^(?:contents|table of contents)$/i.test(clean(l.text)));
  const baselines = new Map(); const numbers = new Map();
  for (const line of lines) {
    const row = Math.round(line.baseline / Math.max(1, size * .35));
    baselines.set(row, [...(baselines.get(row) ?? []), line]);
    if (/^\d{1,6}$/.test(clean(line.text))) {
      const col = Math.round(line.x / size); numbers.set(col, (numbers.get(col) ?? 0) + 1);
    }
  }
  for (const line of lines) {
    const text = clean(line.text);
    const row = Math.round(line.baseline / Math.max(1, size * .35));
    const peers = [row - 1, row, row + 1].flatMap(key => baselines.get(key) ?? []).filter(l => l !== line && Math.abs(l.baseline - line.baseline) < size * .35);
    const numeric = /^\d{1,6}$/.test(text);
    const edge = line.x < width * .12 || line.right > width * .83;
    const sideNumber = !contents && !line.tableLike && numeric && edge && peers.some(l => l.text.length > 15 && (line.x - l.right > size * 1.5 || l.x - line.right > size * 1.5))
      && (numbers.get(Math.round(line.x / size)) ?? 0) >= 2;
    const footer = numeric && Number(text) === pageNumber && line.baseline > height * .945;
    const runningPlay = /\bACT\s+[IVX\d]+[.,]?\s+(?:SC\.?|SCENE)\s*[IVX\d]+/i.test(text) && line.baseline < height * .1 && line.size < size * .9;
    const runningTitle = value => !isHeading(clean(value.text)) && /^\p{L}[\p{L}\s’'.,-]{1,48}$/u.test(clean(value.text)) && value.size <= size * 1.2;
    const headerPair = line.baseline < height * .08 && ((numeric && peers.some(runningTitle))
      || runningTitle(line) && peers.some(l => /^\d{1,4}$/.test(clean(l.text))));
    if (/^FTLN\s*\d+/i.test(text) && edge) result.set(line.id, 'marginal-counter');
    else if (sideNumber) result.set(line.id, 'marginal-counter');
    else if (footer) result.set(line.id, 'page-footer');
    else if (runningPlay || headerPair) result.set(line.id, 'running-header');
  }
  return result;
}

/** Constrained gutter cut. Spanning lines partition horizontal bands first. */
function orderRegions(lines, size, regions, depth = 0, measureWidth = 600) {
  if (!lines.length) return [];
  const box = bounds(lines); const regionWidth = box.right - box.x;
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.x - b.x || a.index - b.index);
  let best = null;
  if (depth < 4 && regionWidth > size * 18) {
    const starts = new Map();
    for (const line of lines) { const x = Math.round(line.x / size) * size - size; starts.set(x, (starts.get(x) ?? 0) + 1); }
    const candidates = [...starts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 24).map(([x]) => x).sort((a, b) => a - b);
    for (const cut of candidates) {
      const left = lines.filter(l => l.right < cut); const right = lines.filter(l => l.x > cut);
      const spanning = lines.filter(l => l.x <= cut && l.right >= cut);
      if (left.length < 2 || right.length < 2 || spanning.length > Math.max(2, lines.length * .28)) continue;
      if (Math.max(...left.map(l => l.right)) - box.x < regionWidth * .19 || box.right - Math.min(...right.map(l => l.x)) < regionWidth * .19) continue;
      if (Math.min(...right.map(l => l.x)) - Math.max(...left.map(l => l.right)) < size * 2) continue;
      if (left.filter(l => /\p{L}{3}/u.test(l.text)).length < 2 || right.filter(l => /\p{L}{3}/u.test(l.text)).length < 2) continue;
      const score = Math.min(left.length, right.length) - spanning.length;
      if (!best || score > best.score) best = { left, right, spanning, score, cut };
    }
  }
  if (best) {
    const spans = best.spanning.sort((a, b) => a.baseline - b.baseline || a.index - b.index);
    const output = []; let previous = -Infinity;
    for (const span of [...spans, null]) {
      const limit = span?.baseline ?? Infinity;
      for (const [index, column] of [best.left, best.right].entries()) output.push(...orderRegions(column.filter(l => l.baseline >= previous && l.baseline < limit), size, regions, depth + 1, index ? box.right - best.cut : best.cut - box.x));
      if (span) { output.push(...orderRegions([span], size, regions, depth + 1, measureWidth)); previous = limit; }
    }
    return output;
  }
  const id = `region-${regions.length}`;
  regions.push({ id, ...box, measureWidth, confidence: 'medium', reasons: ['Local baseline order; no sustained text gutter'] });
  for (const line of sorted) line.regionId = id;
  return sorted;
}

function taggedRoles(tree, runs, lines) {
  if (!tree) return { status: 'absent', roles: new Map() };
  const roles = new Map(); const order = []; let duplicate = false;
  const visit = (node, role) => {
    if (node.type === 'content') { if (roles.has(node.id)) duplicate = true; roles.set(node.id, role); order.push(node.id); }
    else for (const child of node.children ?? []) visit(child, node.role || role);
  };
  visit(tree, '');
  const textRuns = runs.filter(r => clean(r.text));
  const covered = textRuns.every(r => r.markedIds.some(id => roles.has(id)));
  const observed = lines.flatMap(l => l.runs.flatMap(r => r.markedIds.filter(id => roles.has(id))));
  const indexes = observed.map(id => order.indexOf(id));
  const ordered = indexes.every((v, i) => !i || v >= indexes[i - 1]);
  if (duplicate || !covered || !ordered) return { status: 'rejected', reason: 'Incomplete, duplicate or geometrically conflicting marked-content order', roles: new Map() };
  return { status: 'validated', roles };
}

function makeBlocks(lines, regions, size, tags, pageHeight) {
  const blocks = [];
  const labelCount = lines.filter(l => speakerMatch(clean(l.text)) && !isHeading(clean(l.text))).length;
  const drama = labelCount >= 2 && (lines.some(l => /^(?:act|scene)\s+/i.test(l.text)) || labelCount >= 3);
  let speech = null;
  const spacings = lines.slice(1).map((l, i) => l.regionId === lines[i].regionId ? l.baseline - lines[i].baseline : 0).filter(n => n > size * .6 && n < size * 2.5);
  const spacing = median(spacings.length ? spacings : [size * 1.4]);
  const lineRegions = new Set(regions.filter(region => {
    const local = lines.filter(l => l.regionId === region.id && !isHeading(l.text));
    return local.length >= 3 && !local.some(l => l.caps.length)
      && local.filter(l => l.runs.some(r => r.hasEOL)).length >= local.length * .6
      && local.filter(l => !/[.!?:;,]$/.test(l.text)).length >= local.length * .6
      && median(local.map(l => l.right - l.x)) < region.measureWidth * .65;
  }).map(r => r.id));
  for (const [index, line] of lines.entries()) {
    const region = regions.find(r => r.id === line.regionId);
    const width = region.right - region.x;
    const text = clean(line.text);
    const tag = line.runs.flatMap(r => r.markedIds.map(id => tags.roles.get(id))).find(Boolean);
    const explicit = isHeading(text) || /^H[1-6]$/.test(tag ?? '');
    const label = drama && !explicit ? speakerMatch(text) : null;
    const heading = explicit || (!label && !line.caps.length && line.size > size * 1.4 && text.length < 100);
    const centered = width > size * 12 && line.x - region.x > size * 2 && Math.abs((line.x + line.right - region.x - region.right) / 2) < size * 2;
    const direction = drama && !heading && !label && (((centered || line.x - region.x > size * 3 && text.length < 80) && /^(?:Enter|Exit|Exeunt|Flourish|\[|\()/i.test(text))
      || (line.runs.some(r => /italic|oblique/i.test(r.style.fontFamily + r.fontName)) && /^(?:Enter|Exit|Exeunt|\[)/i.test(text)));
    const unsupported = Math.abs(line.angle) > .08 || line.runs.some(r => r.dir !== 'ltr' || r.style.vertical);
    const table = line.tableLike;
    const formula = /[=∑∫√]/u.test(text) && text.length < 100 && !/[.!?]$/.test(text);
    const caption = /^(?:figure|fig\.|table|plate)\s+\d+/i.test(text) && line.size <= size;
    const footnote = /^\d+[.)]?\s+\p{L}/u.test(text) && line.size < size * .8 && line.baseline > pageHeight * .7;
    let role = unsupported || table || formula ? 'unknown' : caption ? 'caption' : footnote ? 'footnote' : heading ? 'heading' : direction ? 'stage-direction' : label ? 'speech' : drama ? 'line-group'
      : /^(?:[•*-]|\d+[.)])\s/u.test(text) || tag === 'LI' ? 'list' : 'paragraph';
    const previous = blocks.at(-1); const before = lines[index - 1];
    const listContinuation = previous?.role === 'list' && role === 'paragraph' && before.regionId === line.regionId
      && line.baseline - before.baseline <= spacing * 1.45 && line.x - previous.lines[0].x > size * .5 && line.x - previous.lines[0].x < size * 4;
    if (listContinuation) role = 'list';
    const short = line.right - line.x < width * .72;
    const uncertainLines = !drama && role === 'paragraph' && short && lines.length >= 3
      && before && before.right - before.x < width * .72 && !/[.!?:;]$/.test(before.text);
    if (uncertainLines || role === 'paragraph' && lineRegions.has(line.regionId)) role = 'line-group';
    const indent = Math.max(0, (line.x - region.x) / size);
    const capFlow = previous?.lines[0].runs.find(r => previous.lines[0].caps.includes(r.id));
    const besideCap = capFlow && line.baseline <= capFlow.bottom + size && line.x >= capFlow.x && line.x - capFlow.right < size * 1.25;
    const returningToBody = previous?.role === 'paragraph' && previous.lines.length === 1 && before.x - region.x > size * .8 && Math.abs(line.x - region.x) < size * .5;
    const boundary = !before || before.regionId !== line.regionId || line.baseline - before.baseline > spacing * 1.45
      || !besideCap && !returningToBody && !listContinuation && Math.abs(line.x - before.x) > size * .8
      || !listContinuation && /[.!?]$/.test(before.text) && before.right - before.x < width * .8;
    if (label) speech = `speech-${line.id}`;
    if (heading) speech = null;
    const association = ['speech', 'line-group', 'stage-direction'].includes(role) ? speech : null;
    const join = previous && previous.regionId === line.regionId && !boundary && !label && role === previous.role && ['paragraph', 'line-group', 'list'].includes(role) && (role !== 'list' || listContinuation) && previous.association === association;
    if (join) {
      previous.lines.push(line);
      if (returningToBody) { previous.firstIndent = previous.indent; previous.indent = 0; }
      if (listContinuation) { previous.indent = indent; previous.firstIndent = -indent; }
    }
    else blocks.push({ id: `block-${line.id}`, regionId: line.regionId, role, association,
      confidence: role === 'unknown' || role === 'line-group' ? 'low' : 'medium',
      reasons: [unsupported ? 'Unsupported direction/orientation: inspect Original' : table || formula ? 'Possible table/formula: inspect Original'
        : caption ? 'Numbered figure/table caption' : footnote ? 'Small numbered text below the body'
        : heading ? 'Numbering, tag or representative typography' : label ? 'Repeated speaker pattern in dramatic context'
          : direction ? 'Stage cue with placement/style and dramatic context' : role === 'line-group' ? 'Preserved source lines; verse/prose uncertain' : 'Local spacing and indentation'],
      align: centered && (heading || direction) ? 'center' : 'start', indent, lines: [line], speaker: label?.[1] ?? null });
  }
  return blocks;
}

function project(blocks, caps) {
  let text = ''; const segments = []; const omitted = [];
  const append = (value, source = null, transform = null) => {
    if (!value) return;
    segments.push({ start: text.length, end: text.length + value.length, source, transform }); text += value;
  };
  for (const [blockIndex, block] of blocks.entries()) {
    if (blockIndex) append('\n\n');
    block.start = text.length;
    for (const [lineIndex, line] of block.lines.entries()) {
      if (lineIndex) append(block.role === 'paragraph' || block.role === 'list' ? ' ' : '\n');
      line.start = text.length; let previous = null;
      for (const run of line.runs) {
        const leading = run.text.length - run.text.trimStart().length; const end = run.text.trimEnd().length;
        if (leading) omitted.push({ item: run.index, start: 0, end: leading, reason: 'Trimmed display whitespace' });
        if (end < run.text.length) omitted.push({ item: run.index, start: end, end: run.text.length, reason: 'Trimmed display whitespace' });
        if (end <= leading) continue;
        if (previous && !caps.has(previous.id) && (run.x - previous.right > run.size * .18 || previous.hasEOL || /\s$/u.test(previous.text) || /^\s/u.test(run.text))) append(' ');
        const expression = /\s+|\S+/gu;
        for (const match of run.text.slice(leading, end).matchAll(expression)) {
          const from = leading + match.index; const whitespace = /^\s/u.test(match[0]);
          append(whitespace ? ' ' : match[0], { item: run.index, start: from, end: from + match[0].length }, whitespace && match[0] !== ' ' ? 'Whitespace collapsed' : null);
        }
        previous = run;
      }
      line.end = text.length;
    }
    block.end = text.length;
  }
  return { text, segments, omitted };
}

/** Every captured source range is accounted for by body, annotations or whitespace. */
export function conservation(layout) {
  const ranges = new Map(layout.runs.map(r => [r.index, []]));
  for (const projection of [layout.projection, ...layout.annotations.map(a => a.projection)]) {
    for (const segment of projection.segments) if (segment.source) ranges.get(segment.source.item)?.push([segment.source.start, segment.source.end]);
    for (const range of projection.omitted) ranges.get(range.item)?.push([range.start, range.end]);
  }
  const errors = [];
  for (const run of layout.runs) {
    let cursor = 0;
    for (const [start, end] of ranges.get(run.index).sort((a, b) => a[0] - b[0])) {
      if (start !== cursor) errors.push(`${run.id}: gap/overlap at ${cursor}`);
      cursor = end;
    }
    if (cursor !== run.text.length) errors.push(`${run.id}: uncovered tail at ${cursor}`);
  }
  return { valid: errors.length === 0, errors };
}

export function interpretPage(content, { pageNumber = 1, view = [0, 0, 600, 800], viewport, structTree, documentId = null, rotation = 0 } = {}) {
  const { runs, matrix } = capture(content, { pageNumber, view, viewport });
  const width = viewport?.width ?? view[2] - view[0]; const height = viewport?.height ?? view[3] - view[1];
  const sizeRuns = runs.filter(r => clean(r.text).length > 1 && !/^FTLN|^\d+$/i.test(clean(r.text))).sort((a, b) => a.size - b.size);
  const weight = sizeRuns.reduce((sum, r) => sum + clean(r.text).length, 0);
  let cumulative = 0;
  const size = sizeRuns.find(r => (cumulative += clean(r.text).length) >= weight / 2)?.size ?? 10;
  const caps = initials(runs, size);
  const rawLines = groupLines(runs, caps, size, width);
  const marginal = annotationLines(rawLines, { width, height, pageNumber }, size);
  const regions = []; const lines = orderRegions(rawLines.filter(l => !marginal.has(l.id)), size, regions, 0, width);
  const tags = taggedRoles(structTree, runs, lines);
  const blocks = makeBlocks(lines, regions, size, tags, height);
  const baselines = [...lines].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lowerBound = y => {
    let low = 0; let high = baselines.length;
    while (low < high) { const middle = (low + high) >>> 1; if (baselines[middle].baseline < y) low = middle + 1; else high = middle; }
    return low;
  };
  const annotations = rawLines.filter(l => marginal.has(l.id)).map(line => {
    const index = lowerBound(line.baseline);
    const y = [baselines[index - 1], baselines[index]].filter(Boolean).sort((a, b) => Math.abs(a.baseline - line.baseline) - Math.abs(b.baseline - line.baseline))[0]?.baseline;
    let nearest = null; let distance = Infinity;
    for (let i = lowerBound(y - size * .35); i < baselines.length && baselines[i].baseline <= y + size * .35; i++) {
      const candidate = baselines[i];
      const gap = Math.abs(candidate.baseline - line.baseline) * 10 + Math.max(0, candidate.x - line.right, line.x - candidate.right);
      if (gap < distance) { nearest = candidate; distance = gap; }
    }
    const block = { id: `annotation-${line.id}`, role: marginal.get(line.id), lines: [line] };
    return { ...block, associatedLine: nearest?.id ?? null, projection: project([block], caps) };
  });
  const projection = project(blocks, caps);
  // Whitespace-only PDF.js items have no visible line, but are still captured.
  for (const run of runs) if (run.text && !clean(run.text)) projection.omitted.push({ item: run.index, start: 0, end: run.text.length, reason: 'Whitespace-only source item' });
  return { version: LAYOUT_VERSION, documentId, page: pageNumber, rotation, extraction: { pdfjs: '6.3.289', includeMarkedContent: true, disableNormalization: false },
    runs, view: [...view], viewportTransform: matrix, width, height, bodySize: size, regions, lines, blocks, annotations, projection,
    decorativeInitials: [...caps].map(([initial, target]) => ({ initial, target, confidence: 'medium', reasons: ['Enlarged single letter adjacent to opening text and overlapping flow'] })),
    tags: { status: tags.status, ...(tags.reason ? { reason: tags.reason } : {}) },
    fallbacks: blocks.filter(b => b.role === 'unknown').map(b => ({ block: b.id, reason: b.reasons[0] })) };
}

export function sourceAt(projection, offset) {
  const mapped = projection.segments.filter(s => s.source);
  const segment = mapped.find(s => s.start <= offset && s.end > offset) ?? mapped.find(s => s.start >= offset) ?? mapped.at(-1);
  if (!segment) return null;
  return { item: segment.source.item, offset: segment.source.start + (segment.transform ? 0 : Math.max(0, Math.min(segment.end - segment.start - 1, offset - segment.start))) };
}
export function offsetForSource(projection, source) {
  return resolveSource(projection, source).offset;
}
export function resolveSource(projection, source) {
  if (!source) return { offset: 0, match: 'page-opening' };
  const mapped = projection.segments.filter(s => s.source);
  const exact = mapped.find(s => s.source.item === source.item && s.source.start <= source.offset && s.source.end > source.offset);
  if (exact) return { offset: exact.start + (exact.transform ? 0 : source.offset - exact.source.start), match: 'exact' };
  const nearest = mapped.filter(s => s.source.item === source.item).sort((a, b) => Math.abs(a.source.start - source.offset) - Math.abs(b.source.start - source.offset))[0];
  if (nearest) return { offset: nearest.start, match: 'nearest-range' };
  const neighbor = mapped.reduce((best, s) => !best || Math.abs(s.source.item - source.item) < Math.abs(best.source.item - source.item) ? s : best, null);
  return { offset: neighbor?.start ?? 0, match: neighbor ? 'nearest-run' : 'page-opening' };
}

/** Stable slices retain block identity, source lines and canonical offsets. */
export function layoutSlice(layout, start = 0, end = layout.projection.text.length) {
  return overlapping(layout.blocks, start, end).map(block => ({ ...block,
    continued: start > block.start,
    lines: overlapping(block.lines, start, end).map(line => ({ ...line,
      text: layout.projection.text.slice(Math.max(start, line.start), Math.min(end, line.end)),
      fragmentStart: Math.max(start, line.start), fragmentEnd: Math.min(end, line.end) })) }));
}

// Projection intervals are ordered and non-overlapping. Skip the source prefix
// in logarithmic time instead of scanning every block/line on every fit probe.
function overlapping(entries, start, end) {
  let low = 0; let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  const result = [];
  for (let index = low; index < entries.length && entries[index].start < end; index++) result.push(entries[index]);
  return result;
}

/** Adapter to the existing Contents evidence contract, preserving PDF y values. */
export function structureLines(layout) {
  const excluded = new Set(layout.blocks.filter(b => ['speech', 'stage-direction', 'caption', 'footnote', 'unknown'].includes(b.role)
    || b.role === 'line-group' && b.association).flatMap(b => b.lines.map(l => l.id)));
  const lists = new Set(layout.blocks.filter(b => b.role === 'list').flatMap(b => b.lines.map(l => l.id)));
  const rows = new Map();
  for (const line of layout.lines) {
    // Horizontal splits retain the tolerant baseline grouping from groupLines.
    const key = line.rowId;
    const row = rows.get(key) ?? []; row.push(line); rows.set(key, row);
  }
  const full = new Map([...rows].map(([key, lines]) => [key, lines.flatMap(l => l.runs).sort((a, b) => a.sourceX - b.sourceX)
    .map(r => ({ text: clean(r.text), x: r.sourceX, right: r.sourceX + r.width, size: capsSize(r, layout) }))]));
  return layout.lines.filter(l => Math.abs(l.angle) < .08).map(line => {
    const fullEntries = full.get(line.rowId);
    return { text: layout.projection.text.slice(line.start, line.end), y: line.sourceY, size: line.size,
      contentsEligible: !excluded.has(line.id) && !lists.has(line.id), tocEligible: !excluded.has(line.id),
      x: Math.min(...line.runs.map(r => r.sourceX)), right: Math.max(...line.runs.map(r => r.sourceX + r.width)),
      fullEntries, fullText: clean(fullEntries.map(e => e.text).join(' ')) };
  }).sort((a, b) => b.y - a.y || a.x - b.x);
}
function capsSize(run, layout) { return layout.decorativeInitials.some(c => c.initial === run.id) ? layout.bodySize : run.size; }
