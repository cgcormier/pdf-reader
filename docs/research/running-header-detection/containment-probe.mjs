// Research probe: patch ignored copies, never the application's modules.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readPageLayout as baseline } from '../../../src/pdf-layout-adapter.js';

if (!process.argv[2]) throw new Error('Usage: node docs/research/running-header-detection/containment-probe.mjs PATH_TO_frank-a5.pdf');
const root = new URL('../../../', import.meta.url);
const out = new URL('output/heading-header-research/containment-probe/', root);
await mkdir(out, { recursive: true });
const insertion = `    // Research-only containment: body-sized explicit label beside an edge folio.
    const bodySized = value => value.size >= size * .9 && value.size <= size * 1.2;
    const explicitLabel = value => bodySized(value) && isHeading(clean(value.text));
    const pairedFolio = value => bodySized(value) && /^(?:\\d{1,6}|[ivxlcdm]{1,8})$/i.test(clean(value.text))
      && (value.x < width * .12 || value.right > width * .83);
    const explicitHeaderPair = line.baseline < height * .1 && bodySized(line)
      && (explicitLabel(line) && peers.some(pairedFolio) || pairedFolio(line) && peers.some(explicitLabel))
      && lines.some(other => other.baseline - line.baseline >= size && other.baseline - line.baseline <= size * 4
        && bodySized(other) && /\\p{L}/u.test(other.text) && !isHeading(clean(other.text)));
`;
const source = await readFile(new URL('src/pdf-layout.js', root), 'utf8');
assert.equal(source.split('    if (/^FTLN').length, 2, 'Detector changed; review insertion point');
assert.equal(source.split('runningPlay || headerPair || combinedHeader').length, 2, 'Detector changed; review dispatch');
await writeFile(new URL('pdf-layout.js', out), source.replace('    if (/^FTLN', insertion + '    if (/^FTLN')
  .replace('runningPlay || headerPair || combinedHeader', 'runningPlay || headerPair || combinedHeader || explicitHeaderPair'));
await writeFile(new URL('pdf-layout-adapter.js', out), await readFile(new URL('src/pdf-layout-adapter.js', root), 'utf8'));
const { readPageLayout: containment } = await import(new URL('pdf-layout-adapter.js', out));
const { interpretPage, conservation } = await import(new URL('pdf-layout.js', out));
const task = getDocument({ data: new Uint8Array(await readFile(process.argv[2])), verbosity: 0 });
try {
  const pdf = await task.promise;
  const results = [];
  for (const page of [33, 77, 81, 82]) {
    const before = await baseline(pdf, page);
    const after = await containment(pdf, page);
    assert(conservation(before).valid && conservation(after).valid);
    const annotations = after.annotations.map(a => ({ role: a.role, text: a.projection.text }));
    if (page === 81 || page === 82) {
      assert(annotations.some(a => a.role === 'running-header' && a.text === 'Chapter VI'));
      assert(annotations.some(a => a.role === 'running-header' && a.text === String(page - 10)));
      const headerIndices = new Set(after.annotations.flatMap(a => a.lines.flatMap(l => l.runs.map(r => r.index))));
      const bodyItems = projection => projection.segments.filter(s => s.source && !headerIndices.has(s.source.item)).map(s => s.source);
      assert.deepEqual(bodyItems(before.projection), bodyItems(after.projection), 'Story source spans changed');
    } else {
      assert(after.blocks.some(b => b.role === 'heading' && after.projection.text.slice(b.start, b.end) === `Chapter ${page === 33 ? 'I' : 'VI'}`));
    }
    results.push({ page, printed: page - 10, annotations, conservation: conservation(after),
      beforeStart: before.projection.text.slice(0, 150), afterStart: after.projection.text.slice(0, 150) });
  }
  const item = (str, x, y, size = 10) => ({ str, width: str.length * size * .45, transform: [size, 0, 0, size, x, y] });
  const edge = interpretPage({ items: [item('Chapter IV', 75, 570),
    item('The genuine opening body begins here.', 75, 540), item('Additional body prose supports the body size.', 75, 526)] },
  { view: [0, 0, 420, 600] });
  assert(edge.blocks.some(b => b.role === 'heading' && edge.projection.text.slice(b.start, b.end) === 'Chapter IV'));
  assert(conservation(edge).valid);
  await writeFile(new URL('results.json', out), JSON.stringify({ results, topEdgeNoFolio: 'retained', status: 'pass' }, null, 2) + '\n');
  console.log('PASS sandbox only: p81/82 title+folio annotated, story source spans unchanged; real p33/77 and top-edge no-folio headings retained.');
} finally { await task.destroy(); }
