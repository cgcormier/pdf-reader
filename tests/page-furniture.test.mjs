import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeLayoutPdf } from './pdf-layout-fixture.mjs';
import { cases } from './display/fixtures.mjs';
import { analyzeDocumentStructure } from '../src/document-structure.js';
import { readPageLayout } from '../src/pdf-layout-adapter.js';
import { conservation } from '../src/pdf-layout.js';
import { resolveReadingPosition } from '../src/layout-reading.js';

for (const fixture of cases) test(`shared furniture evidence preserves source and Contents: ${fixture.name}`, async () => {
  const task = getDocument({ data: makeLayoutPdf(fixture.pages), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const result = await analyzeDocumentStructure(pdf);
    assert.deepEqual(result.nodes.map(({ title, page, y }) => ({ title, page, y })), fixture.contents);
    const resumed = await analyzeDocumentStructure(pdf, { initial: result });
    assert.deepEqual(resumed.furniture, result.furniture);
    for (const page of fixture.checked) {
      const layout = await readPageLayout(pdf, page, { furniture: result.furniture[page] ?? [] });
      assert.deepEqual(conservation(layout), { valid: true, errors: [] });
      assert.equal(layout.projection.text.replace(/\s+/g, ' ').trim(), fixture.expected(page).text);
      assert.deepEqual(layout.blocks.filter(block => block.role === 'heading').map(block => layout.projection.text.slice(block.start, block.end)), fixture.expected(page).headings);
      if (['combined', 'split', 'author'].includes(fixture.name)) assert.ok(layout.annotations.some(a => a.role === 'running-header'));
      const body = layout.projection.segments.find(segment => segment.source);
      const old = { page, offset: 999, layoutVersion: 1, source: { item: body.source.item, offset: body.source.start } };
      assert.equal(resolveReadingPosition({ layout }, old).offset, body.start);
    }
  } finally { await task.destroy(); }
});

test('repeated top-edge openings with opening whitespace do not become furniture', async () => {
  const pages = Array.from({ length: 3 }, (_, i) => ({ items: [
    { text: `Chapter ${i + 1}: The Journey`, x: 60, y: 772, size: 22 },
    ...Array.from({ length: 8 }, (_, n) => ({ text: `The ordinary story continues with line ${n + 1}.`, x: 60, y: 710 - 15 * n, size: 10 })),
  ] }));
  const task = getDocument({ data: makeLayoutPdf(pages), verbosity: 0 });
  try {
    const pdf = await task.promise; const result = await analyzeDocumentStructure(pdf);
    assert.deepEqual(result.nodes.map(n => [n.title, n.page]), pages.map((_, i) => [`Chapter ${i + 1}: The Journey`, i + 1]));
    assert.deepEqual(result.furniture, {});
  } finally { await task.destroy(); }
});


test('chapter ordinal and numbered titles are not discarded as folios', async () => {
  for (const titles of [Array(3).fill('Chapter I'), ['Chapter 1: Rule 1', 'Chapter 1: Rule 2', 'Chapter 1: Rule 3']]) {
    const pages = titles.map(text => ({ items: [
      { text, x: 60, y: 740, size: 15 },
      ...Array.from({ length: 8 }, (_, n) => ({ text: `The ordinary story continues with line ${n + 1}.`, x: 60, y: 705 - 14 * n, size: 10 })),
    ] }));
    const task = getDocument({ data: makeLayoutPdf(pages), verbosity: 0 });
    try {
      const pdf = await task.promise; const result = await analyzeDocumentStructure(pdf);
      assert.deepEqual(result.furniture, {});
      for (let n = 1; n <= 3; n++) {
        const layout = await readPageLayout(pdf, n, { furniture: result.furniture[n] ?? [] });
        assert.ok(layout.projection.text.includes(titles[n - 1]));
      }
    } finally { await task.destroy(); }
  }
});

test('partial scan resume and failed-page retry reconstruct identical furniture evidence', async () => {
  const fixture = cases.find(entry => entry.name === 'combined');
  const task = getDocument({ data: makeLayoutPdf([...fixture.pages, ...fixture.pages]), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const uninterrupted = await analyzeDocumentStructure(pdf);
    const controller = new AbortController(); let checkpoint;
    await assert.rejects(analyzeDocumentStructure(pdf, { signal: controller.signal, onUpdate(snapshot) {
      checkpoint = snapshot; controller.abort();
    } }), { name: 'AbortError' });
    assert.equal(checkpoint.scannedPages.length, 8);
    assert.deepEqual(checkpoint.furniture, {});
    const resumed = await analyzeDocumentStructure(pdf, { initial: checkpoint });
    assert.deepEqual(resumed.furniture, uninterrupted.furniture);
    assert.deepEqual(resumed.nodes, uninterrupted.nodes);
    let fail = true;
    const proxy = { numPages: pdf.numPages, fingerprints: pdf.fingerprints,
      getPageLabels: () => pdf.getPageLabels(), getOutline: () => pdf.getOutline(),
      getPage: number => { if (number === 2 && fail) { fail = false; throw Error('temporary unreadable page'); } return pdf.getPage(number); } };
    const first = await analyzeDocumentStructure(proxy);
    assert.deepEqual(first.failedPages, [2]);
    const retried = await analyzeDocumentStructure(proxy, { initial: first });
    assert.deepEqual(retried.failedPages, []);
    assert.deepEqual(retried.furniture, uninterrupted.furniture);
    assert.deepEqual(retried.nodes, uninterrupted.nodes);
  } finally { await task.destroy(); }
});

test('a one-off generic top-edge title remains a Contents heading', async () => {
  const task = getDocument({ data: makeLayoutPdf([{ items: [
    { text: 'The River Journey', x: 220, y: 772, size: 20 },
    ...Array.from({ length: 8 }, (_, n) => ({ text: `The ordinary story continues with line ${n + 1}.`, x: 60, y: 700 - 15 * n, size: 10 })),
  ] }]), verbosity: 0 });
  try {
    const pdf = await task.promise; const result = await analyzeDocumentStructure(pdf);
    assert.deepEqual(result.nodes.map(n => [n.title, n.page, n.y]), [['The River Journey', 1, 772]]);
    assert.deepEqual(result.furniture, {});
  } finally { await task.destroy(); }
});

test('split structural words and numerals remain semantic chapter headings', async () => {
  const pages = ['I', 'II', 'III'].map(ordinal => ({ items: [
    { text: 'Chapter', x: 200, y: 740, size: 15 }, { text: ordinal, x: 300, y: 740, size: 15 },
    ...Array.from({ length: 8 }, (_, n) => ({ text: `The ordinary story continues with line ${n + 1}.`, x: 60, y: 705 - 14 * n, size: 10 })),
  ] }));
  const task = getDocument({ data: makeLayoutPdf(pages), verbosity: 0 });
  try {
    const pdf = await task.promise; const result = await analyzeDocumentStructure(pdf);
    assert.deepEqual(result.furniture, {});
    for (let n = 1; n <= 3; n++) {
      const layout = await readPageLayout(pdf, n);
      assert.ok(layout.projection.text.includes('Chapter'));
      assert.ok(layout.projection.text.includes(['I', 'II', 'III'][n - 1]));
    }
  } finally { await task.destroy(); }
});
