import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeLayoutPdf } from '../../../tests/pdf-layout-fixture.mjs';
import { analyzeDocumentStructure } from '../../../src/document-structure.js';
import { readPageLayout } from '../../../src/pdf-layout-adapter.js';
import { conservation, structureLines } from '../../../src/pdf-layout.js';

const out = new URL('../../../output/heading-header-research/published-reproduction/', import.meta.url);
await mkdir(out, { recursive: true });
const body = (page, start = 710, count = 28) => Array.from({ length: count }, (_, i) => ({
  text: `The river carried our small boat onward as we watched the quiet wooded shore.`,
  x: 60, y: start - i * 15, size: 10,
}));
const opening = p => ({ text: p < 4 ? 'Chapter 1: River Journey' : 'Chapter 2: The Mountain Road', x: 60, y: 650, size: 22 });
const expected = [{ title: 'Chapter 1: River Journey', page: 1, y: 650 }, { title: 'Chapter 2: The Mountain Road', page: 4, y: 650 }];
function pages({ author = false, y = 740, size = 15, folio = false, split = false, mixed = false } = {}) {
  return Array.from({ length: 6 }, (_, i) => {
    const p = i + 1;
    let title = author ? (mixed ? 'Mary Eleanor Shelley' : 'MARY ELEANOR SHELLEY')
      : p < 4 ? 'Chapter 1: River Journey' : 'Chapter 2: The Mountain Road';
    const headers = split ? [{ text: title, x: 60, y, size }, { text: String(p + 40), x: 530, y, size }]
      : [{ text: `${title}${folio ? ` ${p + 40}` : ''}`, x: 60, y, size }];
    return { items: [...headers, ...(p === 1 || p === 4 ? [opening(p), ...body(p, 610)] : body(p))] };
  });
}
const cases = [
  { name: 'chapter-folio', pages: pages({ folio: true }), expected },
  { name: 'author-no-folio', pages: pages({ author: true }), expected },
  { name: 'chapter-folio-inside-band', pages: pages({ folio: true, y: 772 }), expected },
  { name: 'chapter-folio-small-type', pages: pages({ folio: true, size: 9 }), expected },
  { name: 'author-small-type', pages: pages({ author: true, size: 9 }), expected },
  { name: 'author-inside-band', pages: pages({ author: true, y: 772 }), expected },
  { name: 'author-with-folio', pages: pages({ author: true, folio: true }), expected },
  { name: 'author-mixed-case', pages: pages({ author: true, mixed: true }), expected },
  { name: 'chapter-split-folio', pages: pages({ split: true }), expected },
  { name: 'author-split-folio', pages: pages({ author: true, split: true }), expected },
  { name: 'true-opening-inside-band', pages: [{ items: [{ text: 'Chapter 1: River Journey', x: 60, y: 772, size: 22 }, ...body(1, 710)] }],
    expected: [{ title: 'Chapter 1: River Journey', page: 1, y: 772 }] },
];
const reports = [];
for (const fixture of cases) {
  const bytes = makeLayoutPdf(fixture.pages);
  await writeFile(new URL(`${fixture.name}.pdf`, out), bytes);
  const task = getDocument({ data: bytes, verbosity: 0, standardFontDataUrl: fileURLToPath(new URL('../../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') });
  try {
    const pdf = await task.promise;
    const result = await analyzeDocumentStructure(pdf);
    const layouts = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const layout = await readPageLayout(pdf, p);
      layouts.push({ page: p, conservation: conservation(layout), bodySize: layout.bodySize,
        lines: structureLines(layout), annotations: layout.annotations.map(a => ({ role: a.role, text: a.projection.text })),
        projection: layout.projection.text });
    }
    const actual = result.nodes.map(({ title, page, y }) => ({ title, page, y }));
    const report = { name: fixture.name, expected: fixture.expected, actual, matchesExpected: JSON.stringify(actual) === JSON.stringify(fixture.expected), result, layouts };
    await writeFile(new URL(`${fixture.name}.json`, out), JSON.stringify(report, null, 2) + '\n');
    reports.push({ name: fixture.name, expected: fixture.expected, actual, matchesExpected: report.matchesExpected,
      candidates: result.candidates.map(({title,page}) => ({title,page})), scanned: result.scannedPages.length, failedPages: result.failedPages,
      conserved: layouts.every(l => l.conservation.valid) });
    console.log(`${fixture.name}: ${report.matchesExpected ? 'PASS' : 'MISMATCH'} ${JSON.stringify(actual)}`);
  } finally { await task.destroy(); }
}
await writeFile(new URL('summary.json', out), JSON.stringify(reports, null, 2) + '\n');

// Optional user-supplied real PDF; never copy or publish the PDF itself.
if (process.argv[2]) {
  const bytes = new Uint8Array(await readFile(process.argv[2]));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const task = getDocument({ data: bytes, verbosity: 0 });
  try {
    const pdf = await task.promise;
    const result = await analyzeDocumentStructure(pdf);
    const headerHeadings = [];
    const storyPages = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const layout = await readPageLayout(pdf, page);
      if (!conservation(layout).valid) throw new Error(`Source conservation failed on page ${page}`);
      const lines = structureLines(layout);
      // Coordinates identify the audited Frankenstein edition, not a proposed detector rule.
      headerHeadings.push(...lines.filter(line => line.role === 'heading'
        && Math.abs(line.y - 546.675) < .02).map(line => ({ page, title: line.text, y: line.y })));
      if (page === 81 || page === 82) storyPages.push({ page, text: layout.projection.text,
        lines: lines.filter(line => Math.abs(line.y - 546.675) < .02) });
    }
    const report = { sha256, pages: pdf.numPages, scanned: result.scannedPages.length,
      failedPages: result.failedPages, nodes: result.nodes, headerHeadings, storyPages };
    await writeFile(new URL('frankenstein.json', out), JSON.stringify(report, null, 2) + '\n');
    console.log(`real-pdf: ${JSON.stringify({ sha256, pages: pdf.numPages,
      nodes: result.nodes.length, wrongHeaderRolesAtAuditedBaseline: headerHeadings.length,
      failedPages: result.failedPages })}`);
  } finally { await task.destroy(); }
}
