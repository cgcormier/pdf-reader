// Compact, document-scoped evidence. Coordinates are in the displayed viewport,
// so crop origins and rotation do not change the comparison.
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const folio = text => /^(?:\d{1,4}|[ivxlcdm]{1,8})$/i.test(text);
function titleAndFolio(lines) {
  const parts = lines.map(line => clean(line.text)).filter(Boolean);
  let hasFolio = false; let folioValue = null; let splitFolio = false;
  const titles = [];
  for (let text of parts) {
    if (folio(text) && /^(?:chapter|part|book|section|volume)$/i.test(titles.at(-1) ?? '')) { titles[titles.length - 1] += ` ${text}`; continue; }
    if (folio(text)) { hasFolio = true; splitFolio = true; folioValue = text; continue; }
    // A bare chapter ordinal is semantic, even when it is numeric or Roman.
    if (!/^(?:chapter|part|book|section|volume)\s+(?:\d+|[ivxlcdm]+)$/i.test(text)) {
      const match = text.match(/^(.*?)\s+(\d{1,4})$/) ?? text.match(/^(\d{1,4})\s+(.*)$/);
      if (match) { folioValue = /^\d+$/.test(match[1]) ? match[1] : match[2]; text = /^\d+$/.test(match[1]) ? match[2] : match[1]; hasFolio = true; }
    }
    titles.push(text);
  }
  return { title: clean(titles.join(' ')), hasFolio, folioValue, splitFolio };
}
export function observePageFurniture(layout) {
  const lines = [...layout.lines, ...layout.annotations.flatMap(a => a.lines)];
  const rows = new Map();
  for (const line of lines) { const row = rows.get(line.rowId) ?? []; row.push(line); rows.set(line.rowId, row); }
  const ordered = [...rows.values()].sort((a, b) => a[0].baseline - b[0].baseline);
  const out = [];
  for (const [index, row] of ordered.entries()) {
    row.sort((a, b) => a.x - b.x);
    const first = row[0]; if (first.baseline / layout.height > .12) break;
    const { title, hasFolio, folioValue, splitFolio } = titleAndFolio(row);
    if (splitFolio && !row.some(line => folio(clean(line.text)) && (line.x / layout.width <= .15 || line.right / layout.width >= .68))) continue;
    if (title.length < 4 || title.length > 100 || !/\p{L}/u.test(title) || /[.!?;]$/.test(title)) continue;
    const body = ordered.slice(index + 1).find(other => other[0].baseline > first.baseline + layout.bodySize * .7
      && other.some(line => clean(line.text).length >= 25 && line.size < layout.bodySize * 1.35));
    const gap = body?.[0].baseline - first.baseline;
    const interveningOpening = ordered.slice(index + 1).some(other => other[0].baseline < body?.[0].baseline
      && other.some(line => /^(?:chapter|part|book|section|volume)\s+/i.test(clean(line.text)) && line.size >= layout.bodySize * 1.35));
    if (!body || gap > layout.bodySize * (interveningOpening ? 17 : 7) || !body.some(line => clean(line.text).length >= 25)) continue;
    if (first.size >= layout.bodySize * 1.8 && !interveningOpening) continue;
    if (!hasFolio && first.size >= layout.bodySize * 1.35 && gap > layout.bodySize * 4 && !interveningOpening) continue;
    const titleLines = row.filter(line => !folio(clean(line.text)));
    const x = Math.min(...titleLines.map(line => line.x));
    const right = Math.max(...titleLines.map(line => line.right));
    out.push({ page: layout.page, title: title.toLocaleLowerCase(), y: first.baseline / layout.height,
      edge: Math.min(x / layout.width, 1 - right / layout.width), size: first.size / layout.bodySize,
      hasFolio, folioValue, splitFolio, items: row.flatMap(line => line.runs.map(run => run.index)), lines: row.map(line => line.id), sourceY: first.sourceY });
  }
  return out;
}
export function confirmPageFurniture(observations, headings = []) {
  const confirmed = {};
  for (const row of observations) {
    const matches = observations.filter(other => other.title === row.title && Math.abs(other.y - row.y) <= .012
      && Math.abs(other.edge - row.edge) <= .12 && Math.abs(other.size - row.size) <= .3);
    const pages = new Set(matches.map(other => other.page));
    if (pages.size < 3) continue;
    // A trailing number in a single chapter title can be semantic. Only infer
    // that slot as a folio when a distinct opening corroborates the title.
    if ((!row.hasFolio || !row.splitFolio) && /^(?:chapter|part|book|section|volume)\s/i.test(row.title)
      && !headings.some(h => clean(h.title).toLocaleLowerCase() === row.title
        && !matches.some(candidate => candidate.page === h.page && candidate.lines.includes(h.sourceLineId)))) continue;
    // A numeric slot is only a folio when it tracks physical page numbers.
    // This avoids normalizing changing semantic numbers without page evidence.
    if (row.hasFolio && /^\d+$/.test(row.folioValue ?? '')) {
      const offset = Number(row.folioValue) - row.page;
      if (new Set(matches.filter(other => /^\d+$/.test(other.folioValue ?? '') && Number(other.folioValue) - other.page === offset).map(other => other.page)).size < 3) continue;
    }
    const items = confirmed[row.page] ?? []; items.push(...row.items); confirmed[row.page] = [...new Set(items)].sort((a, b) => a - b);
  }
  return confirmed;
}
